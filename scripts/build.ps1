[CmdletBinding()]
param([string]$OutputDirectory = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $coreRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $coreRoot ('bin\release-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$allowedPrefix = [IO.Path]::GetFullPath($workspaceRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build artifacts must stay inside the Wearden workspace.'
}
$workspaceFile = Join-Path $workspaceRoot 'go.work'
if (-not (Test-Path -LiteralPath $workspaceFile -PathType Leaf)) {
    throw 'Initialize the sibling Go workspace as documented in core/README.md first.'
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$previousOS = $env:GOOS
$previousArch = $env:GOARCH
$previousWork = $env:GOWORK
$previousCGO = $env:CGO_ENABLED
$manifest = @()
Push-Location -LiteralPath $workspaceRoot
try {
    $env:GOWORK = $workspaceFile
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    $targets = @(
        @{ OS = 'linux'; Package = './core/cmd/core'; Name = 'wearden-core-linux-amd64' },
        @{ OS = 'linux'; Package = './agent-linux/cmd/agent'; Name = 'wearden-agent-linux-amd64' },
        @{ OS = 'windows'; Package = './core/cmd/core'; Name = 'wearden-core-windows-amd64.exe' },
        @{ OS = 'windows'; Package = './agent-windows/cmd/agent'; Name = 'wearden-agent-windows-amd64.exe' }
    )
    foreach ($target in $targets) {
        $env:GOOS = $target.OS
        $destination = Join-Path $resolvedOutput $target.Name
        & go build -trimpath -o $destination $target.Package
        if ($LASTEXITCODE -ne 0) { throw ('Compilation failed: ' + $target.Name) }
        $manifest += [pscustomobject]@{
            file = $target.Name
            sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    Copy-Item -LiteralPath (Join-Path $coreRoot 'THIRD_PARTY_NOTICES.md') -Destination $resolvedOutput
    Copy-Item -LiteralPath (Join-Path $workspaceRoot 'agent-linux\THIRD_PARTY_NOTICES.md') -Destination (Join-Path $resolvedOutput 'agent-linux-THIRD_PARTY_NOTICES.md')
    Copy-Item -LiteralPath (Join-Path $workspaceRoot 'agent-windows\THIRD_PARTY_NOTICES.md') -Destination (Join-Path $resolvedOutput 'agent-windows-THIRD_PARTY_NOTICES.md')
    foreach ($repo in @('core','proto','agent-linux','agent-windows')) {
        Copy-Item -LiteralPath (Join-Path $workspaceRoot ($repo + '\LICENSE')) -Destination (Join-Path $resolvedOutput ($repo + '-LICENSE.txt'))
    }
    $goRoot = (& go env GOROOT).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot locate Go license for distribution.' }
    Copy-Item -LiteralPath (Join-Path $goRoot 'LICENSE') -Destination (Join-Path $resolvedOutput 'Go-LICENSE.txt')
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'sha256.json') -Encoding utf8
    Write-Output ('Compiled artifacts: ' + $resolvedOutput)
    Write-Output 'No tests, host scans, deployment or application startup were performed.'
} finally {
    Pop-Location
    $env:GOOS = $previousOS
    $env:GOARCH = $previousArch
    $env:GOWORK = $previousWork
    $env:CGO_ENABLED = $previousCGO
}
