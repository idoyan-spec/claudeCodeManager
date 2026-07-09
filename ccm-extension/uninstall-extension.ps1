# uninstall-extension.ps1  |  BUILD: 2026-07-09 v1
# Removes the side-loaded ccm-hub extension.

$ErrorActionPreference = 'Stop'
Write-Host "Removing ccm-hub VS Code extension..." -ForegroundColor Cyan

$extRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
$matches = Get-ChildItem $extRoot -Directory -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -like 'ccm.hub-*' }

if (-not $matches) { Write-Host "  nothing to remove." -ForegroundColor Yellow; return }
foreach ($m in $matches) {
    Remove-Item $m.FullName -Recurse -Force
    Write-Host "  removed -> $($m.FullName)" -ForegroundColor Green
}
Write-Host "Reload VS Code to finish." -ForegroundColor Yellow
