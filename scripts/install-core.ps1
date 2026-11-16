<#
.SYNOPSIS
  Installs Wearden core on Windows from the prebuilt release (no compiler needed).

.DESCRIPTION
  Run in an elevated PowerShell:
    $f = "$env:TEMP\install-core.ps1"; irm https://github.com/Wearden/core/releases/latest/download/install-core.ps1 -OutFile $f; & $f -DatabaseUrl 'postgresql://user:pass@host:5432/wearden?sslmode=require'

  It downloads wearden-core-windows-amd64.zip, checks its SHA256, installs the core (the dashboard is inside the
  executable), writes the environment file with generated secrets, downloads the agents so workstations can install
  them from this core, and registers a scheduled task that starts core at boot as SYSTEM and restarts it on failure.
  PostgreSQL is not installed for you: pass an existing database with -DatabaseUrl on the first install.
  Running it again upgrades in place; the environment file, the database and the data are kept.

.PARAMETER Version    Release tag to install (default: the latest release).
.PARAMETER Mirror     Download from your own server instead of GitHub (layout: Mirror/core/..., Mirror/agent-linux/..., Mirror/agent-windows/...).
.PARAMETER DatabaseUrl PostgreSQL URL, required on the first install.
.PARAMETER Url        Public address of this core, for example https://wearden.example.com.
.PARAMETER Listen     Address core listens on (default 127.0.0.1:8000; put a TLS reverse proxy in front).
.PARAMETER Dir        Install directory (default C:\Wearden).
.PARAMETER NoAgents   Do not download the agent binaries.
.PARAMETER Uninstall  Stop and remove the task and the program (data and the environment file are kept).
.PARAMETER Purge      With -Uninstall and -Yes: also delete the data and the environment file.
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$Mirror = '',
  [string]$DatabaseUrl = '',
  [string]$Url = '',
  [string]$Listen = '127.0.0.1:8000',
  [string]$Dir = 'C:\Wearden',
  [switch]$NoAgents,
  [switch]$Uninstall,
  [switch]$Purge,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Org = 'Wearden'
$TaskName = 'WeardenCore'
$Data = Join-Path $Dir 'data'
$App = Join-Path $Dir 'app'
$EnvFile = Join-Path $Dir 'core.env'

function Say($m) { Write-Host $m }
function Fail($m) { throw "error: $m" }

if ($Version -and $Version -notmatch '^[A-Za-z0-9._-]+$') { Fail 'the version has unexpected characters' }
if ($Listen -notmatch '^[A-Za-z0-9.:\[\]-]+$') { Fail 'the listen address has unexpected characters' }
if ($Mirror -and $Mirror -notmatch '^https?://[A-Za-z0-9.:/_-]+$') { Fail '-Mirror must be an http or https address' }
if ($Url -and $Url -notmatch '^https?://[A-Za-z0-9.:/_-]+$') { Fail '-Url must be an http or https address' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'run this in an elevated (administrator) PowerShell' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- uninstall
if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Get-Process -Name 'wearden-core' -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  if ($Purge) {
    if (-not $Yes) { Fail '-Purge deletes the data and every stored secret; repeat with -Yes to confirm' }
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    Say 'Wearden was removed, including its data and environment file. The PostgreSQL database was not touched.'
  } else {
    Say "Wearden was stopped and removed. $Data and $EnvFile are kept; run the installer again to bring it back."
  }
  return
}

function Get-AssetUrl([string]$Repo, [string]$File) {
  if ($Mirror) { return ($Mirror.TrimEnd('/') + "/$Repo/$File") }
  if ($Version) { return "https://github.com/$Org/$Repo/releases/download/$Version/$File" }
  return "https://github.com/$Org/$Repo/releases/latest/download/$File"
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("wearden-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null

# Downloads Repo/File into the temp folder and checks it against the release SHA256SUMS.
function Get-Verified([string]$Repo, [string]$File) {
  $dest = Join-Path $Tmp $File
  Invoke-WebRequest -UseBasicParsing -Uri (Get-AssetUrl $Repo $File) -OutFile $dest
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri (Get-AssetUrl $Repo 'SHA256SUMS')).Content
  $want = $null
  foreach ($line in ($sums -split "`n")) {
    if ($line -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($File))\s*$") { $want = $Matches[1].ToLower(); break }
  }
  $have = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
  if (-not $want -or $want -ne $have) { Fail "checksum mismatch for $File, nothing was installed" }
  return $dest
}

try {
  # -------------------------------------------------------------- core
  Say 'Downloading the core release ...'
  $zip = Get-Verified 'core' 'wearden-core-windows-amd64.zip'
  $stage = Join-Path $Tmp 'core'
  Expand-Archive -Path $zip -DestinationPath $stage
  if (-not (Test-Path (Join-Path $stage 'wearden-core.exe'))) { Fail 'the archive does not contain wearden-core.exe' }

  New-Item -ItemType Directory -Force -Path $Dir, $Data, (Join-Path $Data 'recordings'), (Join-Path $Data 'downloads') | Out-Null
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  Get-Process -Name 'wearden-core' -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  Move-Item -Path $stage -Destination $App

  # -------------------------------------------------------------- environment
  if (-not (Test-Path $EnvFile)) {
    if (-not $DatabaseUrl) { Fail 'the first install needs -DatabaseUrl, for example postgresql://user:pass@host:5432/wearden?sslmode=require' }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $vault = [Convert]::ToBase64String($bytes)
    if ($Url) { $origin = $Url } else { $origin = 'http://localhost:' + ($Listen -split ':')[-1] }
    $lines = @(
      "DATABASE_URL=$DatabaseUrl",
      "WEARDEN_VAULT_KEY=$vault",
      "RULESET_PATH=$(Join-Path $App 'ruleset')",
      "LISTEN_ADDR=$Listen",
      "PUBLIC_ORIGIN=$origin",
      "RECORDINGS_DIR=$(Join-Path $Data 'recordings')",
      "AGENT_DOWNLOADS_DIR=$(Join-Path $Data 'downloads')"
    )
    Set-Content -Path $EnvFile -Value $lines -Encoding ASCII
    # Only SYSTEM and administrators may read the secrets.
    & icacls.exe $EnvFile /inheritance:r /grant:r 'SYSTEM:(F)' 'BUILTIN\Administrators:(F)' | Out-Null
    Say "Wrote $EnvFile with generated secrets (keep it private and back it up; the vault key cannot be recovered)."
  } else {
    Say "Keeping the existing $EnvFile (secrets are not regenerated on upgrade)."
  }

  # -------------------------------------------------------------- agents
  if (-not $NoAgents) {
    Say 'Downloading the agents ...'
    $sumLines = @()
    foreach ($spec in @(@('agent-linux', 'wearden-agent-linux-amd64'), @('agent-windows', 'wearden-agent-windows-amd64.exe'))) {
      try {
        $file = Get-Verified $spec[0] $spec[1]
        Copy-Item -Force $file (Join-Path $Data "downloads\$($spec[1])")
        $sumLines += ((Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower() + '  ' + $spec[1])
      } catch {
        Say "skipped $($spec[1]): $($_.Exception.Message)"
      }
    }
    Set-Content -Path (Join-Path $Data 'downloads\SHA256SUMS') -Value $sumLines -Encoding ASCII
  }

  # -------------------------------------------------------------- task
  $runner = Join-Path $Dir 'run-core.ps1'
  $runnerBody = @'
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($line in Get-Content (Join-Path $dir 'core.env')) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
Set-Location (Join-Path $dir 'app')
& (Join-Path $dir 'app\wearden-core.exe')
'@
  Set-Content -Path $runner -Value $runnerBody -Encoding ASCII
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  Say 'Waiting for core to answer ...'
  $listenAddr = ((Get-Content $EnvFile | Where-Object { $_ -like 'LISTEN_ADDR=*' }) -replace '^LISTEN_ADDR=', '')
  $probe = ($listenAddr -split ':')[0]
  if ($probe -eq '0.0.0.0') { $probe = '127.0.0.1' }
  $port = ($listenAddr -split ':')[-1]
  $healthy = $false
  for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
    try { $healthy = (Invoke-WebRequest -UseBasicParsing -Uri "http://${probe}:$port/api/health" -TimeoutSec 3).StatusCode -eq 200 } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $healthy) { Fail 'core did not become healthy; check the database address and run the task by hand to see the error' }

  $origin = ((Get-Content $EnvFile | Where-Object { $_ -like 'PUBLIC_ORIGIN=*' }) -replace '^PUBLIC_ORIGIN=', '')
  Say ''
  Say "Wearden is running (scheduled task: $TaskName)."
  Say "  Open:        $origin"
  Say '  First step:  register on that page. The first account becomes the one and only administrator;'
  Say "               everyone who registers later waits for the administrator's approval."
  Say '  Agents:      in Wearden go to Assets, Agents, Enroll a new agent, and copy the one-line command.'
  if ($origin -notlike 'https://*') { Say '  Note:        agents refuse plain http for a core on another machine. Put a TLS reverse proxy in front and use its https address with -Url.' }
  Say '  Upgrade:     run the installer again. Remove: add -Uninstall (and -Purge -Yes to delete data).'
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
