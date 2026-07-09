# install-extension.ps1  |  BUILD: 2026-07-09 v3 status-icons
# Side-loads the buildless ccm-hub extension by copying it into VS Code's
# per-user extensions folder. No npm, no vsce, no admin.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\install-extension.ps1

$ErrorActionPreference = 'Stop'
Write-Host "Installing ccm-hub VS Code extension..." -ForegroundColor Cyan

$src = Join-Path $PSScriptRoot 'ccm-hub'
if (-not (Test-Path (Join-Path $src 'package.json'))) {
    throw "ccm-hub source not found next to this script ($src)."
}

# read version from package.json to build the target folder name <publisher>.<name>-<version>
$pkg     = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
$destName = "$($pkg.publisher).$($pkg.name)-$($pkg.version)"
$extRoot  = Join-Path $env:USERPROFILE '.vscode\extensions'
$dest     = Join-Path $extRoot $destName

New-Item -ItemType Directory -Force -Path $extRoot | Out-Null

# Drop every earlier copy of this extension id. Two folders sharing one id
# (ccm.hub-0.0.1 and ccm.hub-0.0.2) leave VS Code loading a stale extension.
Get-ChildItem -Path $extRoot -Directory -Filter "$($pkg.publisher).$($pkg.name)-*" -ErrorAction SilentlyContinue |
    ForEach-Object {
        Write-Host "  removing old copy: $($_.Name)" -ForegroundColor DarkGray
        Remove-Item $_.FullName -Recurse -Force
    }

Copy-Item $src $dest -Recurse -Force

Write-Host "  installed -> $dest" -ForegroundColor Green
Write-Host "  URI: vscode://$($pkg.publisher).$($pkg.name)/session?path=<folder>"
Write-Host ""
Write-Host "RELOAD VS Code (or open a new window) to activate the extension." -ForegroundColor Yellow
