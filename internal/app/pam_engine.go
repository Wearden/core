package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/Wearden/core/internal/benchmarks"
)

// Pure PAM engine logic, ported from the HardenOps (sechard) engine: result
// evaluation, typed backup capture, restore scripts, the safety net for risky
// changes and rollback command templating. Nothing here talks to a host.
//
// Script generation rules:
//   - Only values captured from the host, or written in the benchmark YAML, end up in a script.
//   - Captured values are base64 encoded when written into a script, so they cannot break out of quoting.
//   - Paths are shell quoted (Linux) or single quote escaped (Windows).

const (
	pamPass          = "pass"
	pamFail          = "fail"
	pamError         = "error"
	pamNotApplicable = "not_applicable"

	pamCapturePrefix   = "@@WD@@"
	pamMaxContentBytes = 256 * 1024
	pamRevertDir       = "/var/lib/wearden-pam/revert"
	pamWinRevertDir    = `C:\ProgramData\WeardenPAM`
	pamBeforeToken     = "{before}"
)

// Password hashes are never captured into core.
var pamSensitiveFiles = map[string]bool{"/etc/shadow": true, "/etc/gshadow": true}

var pamSafeBefore = regexp.MustCompile(`^[A-Za-z0-9 _.,:\-]{0,64}$`)

func pamLastLine(text string) string {
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return l
		}
	}
	return ""
}

// pamEvaluate turns the stripped audit output into a control status and message.
func pamEvaluate(auditType, match, expected, output string) (string, string) {
	out := strings.TrimSpace(output)
	// A sysctl key that does not exist on this kernel (common in containers) is not applicable.
	if auditType == "sysctl" && out == "" {
		return pamNotApplicable, "setting is not present on this system"
	}
	var ok bool
	switch match {
	case "equals":
		ok = out == strings.TrimSpace(expected)
	case "contains":
		ok = strings.Contains(out, expected)
	case "regex":
		re, err := regexp.Compile("(?m)" + expected)
		if err != nil {
			return pamError, "invalid expected pattern: " + err.Error()
		}
		ok = re.MatchString(out)
	case "not_exists":
		ok = out == ""
	case "numeric_gte", "numeric_lte":
		if out == "" {
			return pamFail, "no value found"
		}
		value, err := strconv.ParseFloat(pamLastLine(out), 64)
		if err != nil {
			return pamError, "output is not a number"
		}
		target, err := strconv.ParseFloat(expected, 64)
		if err != nil {
			return pamError, "expected value is not a number"
		}
		if match == "numeric_gte" {
			ok = value >= target
		} else {
			ok = value <= target
		}
	default:
		return pamError, "unknown matcher " + match
	}
	if ok {
		return pamPass, ""
	}
	return pamFail, "value does not match the expected result"
}

type pamCheck struct {
	Status   string
	Actual   *string
	Raw      *string
	Message  *string
	Duration int64
}

func pamStrPtr(s string) *string { return &s }

// pamCheckFromResult applies the scan rules to one audit command result.
func pamCheckFromResult(control benchmarks.Control, res pamResult) pamCheck {
	out := strings.TrimSpace(res.Stdout)
	raw := res.Stdout
	if res.Stderr != "" {
		raw += "\n--- stderr ---\n" + res.Stderr
	}
	if len(raw) > 4000 {
		raw = raw[:4000]
	}
	check := pamCheck{}
	if raw != "" {
		check.Raw = pamStrPtr(raw)
	}
	if out != "" {
		first := strings.SplitN(out, "\n", 2)[0]
		if len(first) > 500 {
			first = first[:500]
		}
		check.Actual = pamStrPtr(strings.TrimSpace(first))
	}
	if out == "" && res.ExitCode != 0 && control.Audit.Type != "sysctl" {
		msg := "command failed"
		if e := strings.TrimSpace(res.Stderr); e != "" {
			msg = strings.SplitN(e, "\n", 2)[0]
			if len(msg) > 300 {
				msg = msg[:300]
			}
		}
		check.Status, check.Message = pamError, pamStrPtr(msg)
		return check
	}
	status, msg := pamEvaluate(control.Audit.Type, control.Audit.Match, control.Audit.Expected, out)
	check.Status = status
	if msg != "" {
		check.Message = pamStrPtr(msg)
	}
	return check
}

// pamOrder puts non-risky controls first, so a risky change (for example SSH root
// login) lands after the safe ones.
func pamOrder(ids []string, controls map[string]benchmarks.Control) []string {
	out := append([]string{}, ids...)
	sort.SliceStable(out, func(i, j int) bool {
		return !controls[out[i]].Risky && controls[out[j]].Risky
	})
	return out
}

// pamSubstituteBefore fills {before} in a rollback command with the captured value.
// Only simple values are accepted, so a captured string can never inject commands.
func pamSubstituteBefore(command string, before *string) (string, error) {
	if !strings.Contains(command, pamBeforeToken) {
		return command, nil
	}
	value := ""
	if before != nil {
		value = strings.TrimSpace(*before)
	}
	if !pamSafeBefore.MatchString(value) {
		return "", errors.New("captured value is not safe to use in a rollback command")
	}
	return strings.ReplaceAll(command, pamBeforeToken, value), nil
}

func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'" }

func psQuote(s string) string { return strings.ReplaceAll(s, "'", "''") }

func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ---- Linux capture and restore ----

func pamLinuxCapture(backups []benchmarks.BackupItem) string {
	lines := []string{"set +e"}
	for _, item := range backups {
		path, name := strOr(item.Path), strOr(item.Name)
		switch {
		case item.Type == "file" && path != "":
			q := shQuote(path)
			content := ""
			if !pamSensitiveFiles[path] {
				content = fmt.Sprintf("if [ -f %s ] && [ $(stat -c %%s %s) -le %d ]; then content=$(base64 -w0 %s); fi; ", q, q, pamMaxContentBytes, q)
			}
			lines = append(lines, fmt.Sprintf("if [ -e %s ]; then meta=$(stat -c '%%a %%U %%G' %s 2>/dev/null); content=''; %sprintf '%s\\tFILE\\t%%s\\t1\\t%%s\\t%%s\\n' %s \"$meta\" \"$content\"; else printf '%s\\tFILE\\t%%s\\t0\\t\\t\\n' %s; fi", q, q, content, pamCapturePrefix, q, pamCapturePrefix, q))
		case item.Type == "sysctl" && name != "":
			q := shQuote(name)
			lines = append(lines, fmt.Sprintf("printf '%s\\tSYSCTL\\t%%s\\t%%s\\n' %s \"$(sysctl -n %s 2>/dev/null)\"", pamCapturePrefix, q, q))
		case item.Type == "service" && name != "":
			q := shQuote(name)
			lines = append(lines, fmt.Sprintf("printf '%s\\tSERVICE\\t%%s\\t%%s\\t%%s\\n' %s \"$(systemctl is-enabled %s 2>/dev/null || true)\" \"$(systemctl is-active %s 2>/dev/null || true)\"", pamCapturePrefix, q, q, q))
		case item.Type == "command" && path != "":
			q := shQuote(path)
			lines = append(lines, fmt.Sprintf("out=$(bash -c %s 2>/dev/null | head -c 2000 | base64 -w0); printf '%s\\tCMD\\t%%s\\t%%s\\n' %s \"$out\"", q, pamCapturePrefix, q))
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

// pamEntry is one captured piece of state. Linux and Windows entries share the map form.
type pamEntry map[string]any

func pamParseLinuxCapture(output string) ([]pamEntry, []string) {
	entries := []pamEntry{}
	warnings := []string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimRight(line, "\r")
		if !strings.HasPrefix(line, pamCapturePrefix+"\t") {
			continue
		}
		parts := strings.Split(line, "\t")[1:]
		at := func(i int) string {
			if i < len(parts) {
				return parts[i]
			}
			return ""
		}
		switch parts[0] {
		case "FILE":
			path, existed := at(1), at(2) == "1"
			meta := strings.Fields(at(3))
			for len(meta) < 3 {
				meta = append(meta, "")
			}
			var content any
			if at(4) != "" {
				content = at(4)
			}
			entries = append(entries, pamEntry{"type": "file", "path": path, "existed": existed, "mode": meta[0], "owner": meta[1], "group": meta[2], "content_b64": content})
			if existed && at(4) == "" && !pamSensitiveFiles[path] {
				warnings = append(warnings, fmt.Sprintf("%s: content not kept (directory or over %d bytes); only metadata will be restored", path, pamMaxContentBytes))
			}
		case "SYSCTL":
			entries = append(entries, pamEntry{"type": "sysctl", "name": at(1), "value": at(2)})
		case "SERVICE":
			entries = append(entries, pamEntry{"type": "service", "name": at(1), "enabled": at(2), "active": at(3)})
		case "CMD":
			text := ""
			if raw, err := base64.StdEncoding.DecodeString(at(2)); err == nil {
				text = strings.ToValidUTF8(string(raw), "?")
			}
			entries = append(entries, pamEntry{"type": "command", "path": at(1), "output": text})
		}
	}
	return entries, warnings
}

func entryStr(e pamEntry, key string) string {
	v, _ := e[key].(string)
	return v
}

func entryBool(e pamEntry, key string) bool {
	v, _ := e[key].(bool)
	return v
}

// pamLinuxRestore restores captured state. Exit status is 0 only if every step succeeded.
func pamLinuxRestore(entries []pamEntry) string {
	steps := []string{"rc=0"}
	reloadSSH, reloadAudit := false, false
	for _, e := range entries {
		if entryStr(e, "type") != "file" {
			continue
		}
		path := entryStr(e, "path")
		q := shQuote(path)
		if entryBool(e, "existed") {
			if c := entryStr(e, "content_b64"); c != "" {
				steps = append(steps, fmt.Sprintf("printf '%%s' %s | base64 -d > %s || rc=1", shQuote(c), q))
			}
			if o, g := entryStr(e, "owner"), entryStr(e, "group"); o != "" && g != "" {
				steps = append(steps, fmt.Sprintf("chown %s %s || rc=1", shQuote(o+":"+g), q))
			}
			if m := entryStr(e, "mode"); m != "" {
				steps = append(steps, fmt.Sprintf("chmod %s %s || rc=1", shQuote(m), q))
			}
		} else {
			steps = append(steps, fmt.Sprintf("rm -f %s || rc=1", q))
		}
		reloadSSH = reloadSSH || strings.HasPrefix(path, "/etc/ssh")
		reloadAudit = reloadAudit || strings.HasPrefix(path, "/etc/audit")
	}
	for _, e := range entries {
		if entryStr(e, "type") == "sysctl" && entryStr(e, "value") != "" {
			steps = append(steps, fmt.Sprintf("sysctl -w %s >/dev/null || rc=1", shQuote(entryStr(e, "name")+"="+entryStr(e, "value"))))
		}
	}
	for _, e := range entries {
		if entryStr(e, "type") != "service" {
			continue
		}
		q := shQuote(entryStr(e, "name"))
		switch entryStr(e, "enabled") {
		case "enabled", "enabled-runtime":
			steps = append(steps, fmt.Sprintf("systemctl enable %s >/dev/null 2>&1 || true", q))
		case "disabled":
			steps = append(steps, fmt.Sprintf("systemctl disable %s >/dev/null 2>&1 || true", q))
		case "masked":
			steps = append(steps, fmt.Sprintf("systemctl mask %s >/dev/null 2>&1 || true", q))
		}
		switch entryStr(e, "active") {
		case "active":
			steps = append(steps, fmt.Sprintf("systemctl start %s >/dev/null 2>&1 || true", q))
		case "inactive", "failed":
			steps = append(steps, fmt.Sprintf("systemctl stop %s >/dev/null 2>&1 || true", q))
		}
	}
	if reloadSSH {
		steps = append(steps, "systemctl reload ssh >/dev/null 2>&1 || true")
	}
	if reloadAudit {
		steps = append(steps, "augenrules --load >/dev/null 2>&1 || true")
	}
	steps = append(steps, "exit $rc")
	return strings.Join(steps, "\n") + "\n"
}

// The safety net for a risky Linux change: a transient systemd timer runs the restore
// script after the window unless core reconnects and disarms it first.
func pamLinuxArm(changeID int64, windowSeconds int, restore string) string {
	unit := fmt.Sprintf("wearden-pam-revert-%d", changeID)
	path := fmt.Sprintf("%s/%d.sh", pamRevertDir, changeID)
	payload := base64.StdEncoding.EncodeToString([]byte(restore))
	return fmt.Sprintf("mkdir -p %s && printf '%%s' %s | base64 -d > %s && chmod 700 %s && systemd-run --on-active=%d --unit=%s --collect /bin/bash %s >/dev/null && echo ARMED", pamRevertDir, shQuote(payload), path, path, windowSeconds, unit, path)
}

func pamLinuxDisarm(changeID int64) string {
	timer := fmt.Sprintf("wearden-pam-revert-%d.timer", changeID)
	return fmt.Sprintf("if systemctl is-active --quiet %s; then systemctl stop %s && echo DISARMED; else echo ALREADY_FIRED; fi", timer, timer)
}

// ---- Windows capture and restore ----

var pamSeceditArea = regexp.MustCompile(`[^A-Z_]`)

func pamWindowsCapture(backups []benchmarks.BackupItem) string {
	lines := []string{}
	emit := func(fields string) string {
		return fmt.Sprintf("Write-Output ('%s' + (@{%s} | ConvertTo-Json -Compress))", pamCapturePrefix, fields)
	}
	for _, item := range backups {
		path, name := strOr(item.Path), strOr(item.Name)
		switch {
		case item.Type == "registry" && path != "" && name != "":
			lines = append(lines, fmt.Sprintf("$p='%s'; $n='%s'; $v=Get-ItemProperty -LiteralPath $p -Name $n -ErrorAction SilentlyContinue; $e=($null -ne $v); $s=''; if ($e) { $s=[string]$v.$n }; ", psQuote(path), psQuote(name))+
				emit("t='reg';p=$p;n=$n;e=$e;v=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))"))
		case item.Type == "secedit" && path != "":
			area := pamSeceditArea.ReplaceAllString(path, "")
			lines = append(lines, fmt.Sprintf("$f=Join-Path $env:TEMP ('wearden-cap-' + [guid]::NewGuid().ToString() + '.inf'); secedit /export /cfg $f /areas %s | Out-Null; $b=[IO.File]::ReadAllBytes($f); Remove-Item $f -Force; ", area)+
				emit(fmt.Sprintf("t='secedit';a='%s';b=[Convert]::ToBase64String($b)", area)))
		case item.Type == "netaccounts":
			lines = append(lines, "$f=Join-Path $env:TEMP ('wearden-cap-' + [guid]::NewGuid().ToString() + '.inf'); secedit /export /cfg $f /areas SECURITYPOLICY | Out-Null; $b=[IO.File]::ReadAllBytes($f); Remove-Item $f -Force; "+
				emit("t='secedit';a='SECURITYPOLICY';b=[Convert]::ToBase64String($b)"))
		case item.Type == "localuser" && name != "":
			n := psQuote(name)
			lines = append(lines, fmt.Sprintf("$u=Get-LocalUser -Name '%s' -ErrorAction SilentlyContinue; ", n)+
				emit(fmt.Sprintf("t='localuser';n='%s';e=($null -ne $u);v=[bool]($u -and $u.Enabled)", n)))
		case item.Type == "auditpol" && name != "":
			n := psQuote(name)
			lines = append(lines, fmt.Sprintf("$r=(auditpol /get /subcategory:\"%s\" /r | ConvertFrom-Csv); ", n)+
				emit(fmt.Sprintf("t='auditpol';n='%s';v=[string]$r.'Inclusion Setting'", n)))
		case item.Type == "netfirewall" && name != "":
			n := psQuote(name)
			lines = append(lines, fmt.Sprintf("$p=Get-NetFirewallProfile -Name '%s'; ", n)+
				emit(fmt.Sprintf("t='netfw';n='%s';en=[string]$p.Enabled;di=[string]$p.DefaultInboundAction;lb=[string]$p.LogBlocked;ls=[string]$p.LogMaxSizeKilobytes", n)))
		case item.Type == "service" && name != "":
			n := psQuote(name)
			lines = append(lines, fmt.Sprintf("$s=Get-Service -Name '%s' -ErrorAction SilentlyContinue; ", n)+
				emit(fmt.Sprintf("t='svc';n='%s';e=($null -ne $s);st=[string]$(if($s){$s.StartType}else{''});ss=[string]$(if($s){$s.Status}else{''})", n)))
		case item.Type == "command" && path != "":
			c := psQuote(path)
			lines = append(lines, fmt.Sprintf("$o=(Invoke-Expression '%s' 2>$null | Out-String); ", c)+
				emit(fmt.Sprintf("t='cmd';c='%s';o=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($o))", c)))
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func pamParseWindowsCapture(output string) []pamEntry {
	entries := []pamEntry{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, pamCapturePrefix) {
			continue
		}
		var e pamEntry
		if json.Unmarshal([]byte(line[len(pamCapturePrefix):]), &e) == nil {
			entries = append(entries, e)
		}
	}
	return entries
}

var pamPSIdent = regexp.MustCompile(`^[A-Za-z]+$`)
var pamPSNumber = regexp.MustCompile(`^[0-9]+$`)

// pamWindowsRestore restores captured state. It keeps going after a failed step and
// exits 1 if any step failed.
func pamWindowsRestore(entries []pamEntry) string {
	lines := []string{"$ErrorActionPreference = 'Continue'", "$script:rc = 0"}
	for _, e := range entries {
		switch entryStr(e, "t") {
		case "reg":
			p, n := psQuote(entryStr(e, "p")), psQuote(entryStr(e, "n"))
			var body string
			if entryBool(e, "e") {
				raw, _ := base64.StdEncoding.DecodeString(entryStr(e, "v"))
				value := string(raw)
				if v, err := strconv.ParseUint(value, 10, 64); err == nil && pamPSNumber.MatchString(value) && v <= 4294967295 {
					body = fmt.Sprintf("Set-ItemProperty -LiteralPath '%s' -Name '%s' -Value %d -Type DWord -Force", p, n, v)
				} else {
					body = fmt.Sprintf("Set-ItemProperty -LiteralPath '%s' -Name '%s' -Value '%s' -Type String -Force", p, n, psQuote(value))
				}
			} else {
				body = fmt.Sprintf("Remove-ItemProperty -LiteralPath '%s' -Name '%s' -ErrorAction SilentlyContinue", p, n)
			}
			lines = append(lines, fmt.Sprintf("try { %s } catch { $script:rc = 1 }", body))
		case "secedit":
			area := pamSeceditArea.ReplaceAllString(entryStr(e, "a"), "")
			b := entryStr(e, "b")
			if _, err := base64.StdEncoding.DecodeString(b); err != nil || area == "" {
				lines = append(lines, "$script:rc = 1")
				continue
			}
			lines = append(lines, fmt.Sprintf("$f=Join-Path $env:TEMP ('wearden-restore-' + [guid]::NewGuid().ToString() + '.inf'); [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String('%s')); $d=Join-Path $env:TEMP 'wearden-restore.sdb'; secedit /configure /db $d /cfg $f /areas %s /quiet | Out-Null; if ($LASTEXITCODE -ne 0) { $script:rc = 1 }; Remove-Item $f -Force -ErrorAction SilentlyContinue", b, area))
		case "localuser":
			if !entryBool(e, "e") {
				continue
			}
			verb := "Disable-LocalUser"
			if entryBool(e, "v") {
				verb = "Enable-LocalUser"
			}
			lines = append(lines, fmt.Sprintf("try { %s -Name '%s' } catch { $script:rc = 1 }", verb, psQuote(entryStr(e, "n"))))
		case "auditpol":
			success, failure := "disable", "disable"
			switch entryStr(e, "v") {
			case "Success and Failure":
				success, failure = "enable", "enable"
			case "Success":
				success = "enable"
			case "Failure":
				failure = "enable"
			}
			n := strings.ReplaceAll(psQuote(entryStr(e, "n")), `"`, "")
			lines = append(lines, fmt.Sprintf("auditpol /set /subcategory:\"%s\" /success:%s /failure:%s | Out-Null; if ($LASTEXITCODE -ne 0) { $script:rc = 1 }", n, success, failure))
		case "netfw":
			args := []string{}
			for _, kv := range [][2]string{{"en", "-Enabled"}, {"di", "-DefaultInboundAction"}, {"lb", "-LogBlocked"}, {"ls", "-LogMaxSizeKilobytes"}} {
				v := entryStr(e, kv[0])
				if v != "" && (pamPSIdent.MatchString(v) || pamPSNumber.MatchString(v)) {
					args = append(args, kv[1]+" "+v)
				}
			}
			if len(args) > 0 {
				lines = append(lines, fmt.Sprintf("try { Set-NetFirewallProfile -Name '%s' %s } catch { $script:rc = 1 }", psQuote(entryStr(e, "n")), strings.Join(args, " ")))
			}
		case "svc":
			if !entryBool(e, "e") {
				continue
			}
			n := psQuote(entryStr(e, "n"))
			if st := entryStr(e, "st"); pamPSIdent.MatchString(st) {
				lines = append(lines, fmt.Sprintf("try { Set-Service -Name '%s' -StartupType %s } catch { $script:rc = 1 }", n, st))
			}
			switch entryStr(e, "ss") {
			case "Running":
				lines = append(lines, fmt.Sprintf("try { Start-Service -Name '%s' } catch { }", n))
			case "Stopped":
				lines = append(lines, fmt.Sprintf("try { Stop-Service -Name '%s' -Force } catch { }", n))
			}
		}
	}
	lines = append(lines, "exit $script:rc")
	return strings.Join(lines, "\n") + "\n"
}

// The safety net for a risky Windows change: a one-shot scheduled task as SYSTEM.
func pamWindowsArm(changeID int64, windowSeconds int, restore string) string {
	name := fmt.Sprintf("wearden-pam-revert-%d", changeID)
	path := fmt.Sprintf(`%s\revert-%d.ps1`, pamWinRevertDir, changeID)
	payload := base64.StdEncoding.EncodeToString([]byte(restore))
	return fmt.Sprintf("[IO.Directory]::CreateDirectory('%s') | Out-Null; [IO.File]::WriteAllText('%s', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s'))); $a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File \"%s\"'; $t=New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(%d); Register-ScheduledTask -TaskName '%s' -Action $a -Trigger $t -User 'SYSTEM' -RunLevel Highest -Force | Out-Null; 'ARMED'", pamWinRevertDir, path, payload, path, windowSeconds, name)
}

func pamWindowsDisarm(changeID int64) string {
	name := fmt.Sprintf("wearden-pam-revert-%d", changeID)
	return fmt.Sprintf("if (Get-ScheduledTask -TaskName '%s' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '%s' -Confirm:$false; 'DISARMED' } else { 'ALREADY_FIRED' }", name, name)
}

func pamCaptureScript(osType string, backups []benchmarks.BackupItem) string {
	if osType == "linux" {
		return pamLinuxCapture(backups)
	}
	return pamWindowsCapture(backups)
}

func pamRestoreScript(osType string, entries []pamEntry) string {
	if osType == "linux" {
		return pamLinuxRestore(entries)
	}
	return pamWindowsRestore(entries)
}

func pamArmScript(osType string, changeID int64, windowSeconds int, restore string) string {
	if osType == "linux" {
		return pamLinuxArm(changeID, windowSeconds, restore)
	}
	return pamWindowsArm(changeID, windowSeconds, restore)
}

func pamDisarmScript(osType string, changeID int64) string {
	if osType == "linux" {
		return pamLinuxDisarm(changeID)
	}
	return pamWindowsDisarm(changeID)
}

func pamDescribeBackups(backups []benchmarks.BackupItem) []string {
	out := []string{}
	for _, b := range backups {
		label := b.Type
		if v := strOr(b.Path); v != "" {
			label += ": " + v
		} else if v := strOr(b.Name); v != "" {
			label += ": " + v
		}
		out = append(out, label)
	}
	return out
}
