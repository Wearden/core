# Linux SSH native write integration analysis

Source-only checkpoint. No tests, native scans, SSH reloads or host changes were executed. All14 SSH content controls remain required; this document does not enable or remove them.

| Control | Compiled target |
| --- | --- |
| LNX-SSH-002 | `loglevel` |
| LNX-SSH-003 | `x11forwarding` |
| LNX-SSH-004 | `maxauthtries` |
| LNX-SSH-005 | `ignorerhosts` |
| LNX-SSH-006 | `hostbasedauthentication` |
| LNX-SSH-007 | `permitrootlogin` |
| LNX-SSH-008 | `permitemptypasswords` |
| LNX-SSH-009 | `permituserenvironment` |
| LNX-SSH-010 | `clientaliveinterval` |
| LNX-SSH-011 | `clientalivecountmax` |
| LNX-SSH-012 | `logingracetime` |
| LNX-SSH-013 | `maxsessions` |
| LNX-SSH-014 | `usepam` |
| LNX-SSH-015 | `banner` |

## Existing integration points

checks/native.go sshConfig resolves first-value precedence and the fixed /etc/ssh/sshd_config.d/*.conf include, rejecting Match blocks and unreviewed quoting/includes. planMutation in cmd/agent/actions_linux.go currently supports dedicated file/sysctl/metadata plans. Directory creation and missing-parent snapshots separately whitelist journald, modprobe and sysctl locations. Both policies must be extended together for an SSH drop-in; changing only one leaves recovery inconsistent.

Apply currently rejects error evidence except the explicit absent journald setting. An implicit SSH option is an error with a distinct message, so enabling a writer alone cannot cover default/absent settings. Do not permit all SSH errors: malformed, Match-dependent and inaccessible evidence must stay refused. A reviewed absent-option path needs explicit applicability and include-precedence evidence.

## Required implementation sequence

1. Define fixed ID/option/value plans matching the14 source controls; no network-provided option, path or value. Preserve tighter compliant numeric limits.
2. Prove the standard include is effective before the managed option. A managed drop-in that loses first-value precedence must fail and restore; appending a line to the main file is insufficient.
3. Extend both trusted-directory checks, exact backup validation, interruption recovery and restore handling for the managed SSH path. Retain root ancestry, NOFOLLOW, hardlink/ACL/xattr and private-state restrictions.
4. Cover banner-file existence/content as a separate dependency rather than claiming a Banner path alone creates a warning. Inspect the original baseline before choosing backup/write scope.
5. Decide and implement the native daemon validation/reload mechanism with its own rollback semantics. A configuration-file observation does not prove the running daemon adopted the change. Never substitute execution of YAML commands or shell scripts.
6. Wire core capability/risk metadata only after those paths exist, update both release catalogs only when their definitions change, and refresh remaining-native-writes.json. Compile Windows/Linux targets. Tests and live native operations remain prohibited by the user.

The next implementation must address these linked paths as one provider change; a broad generic file writer would bypass existing precheck/recovery boundaries. Current Linux write coverage remains27 controls.
