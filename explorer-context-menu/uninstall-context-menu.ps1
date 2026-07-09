# uninstall-context-menu.ps1  |  BUILD: 2026-07-09 v1
# Removes the ccm Explorer right-click entries created by install-context-menu.ps1.
# Also removes any legacy machine-wide (HKCR) entries from earlier experiments,
# self-elevating only if such legacy entries are actually present.

$ErrorActionPreference = 'Stop'
Write-Host "Removing ccm Explorer context-menu entries..." -ForegroundColor Cyan

# --- per-user entries (no admin needed) ---
$userKeys = @(
  'HKCU:\Software\Classes\Directory\shell\ClaudeCodeAuto',
  'HKCU:\Software\Classes\Directory\shell\ClaudeCodeVSCode',
  'HKCU:\Software\Classes\Directory\Background\shell\ClaudeCodeAuto',
  'HKCU:\Software\Classes\Directory\Background\shell\ClaudeCodeVSCode'
)
foreach ($k in $userKeys) {
  if (Test-Path $k) { Remove-Item $k -Recurse -Force; Write-Host "  removed $k" }
}

# --- legacy machine-wide entries from earlier experiments (need admin) ---
$legacy = @(
  'HKEY_CLASSES_ROOT\Directory\shell\ClaudeCode',
  'HKEY_CLASSES_ROOT\Directory\shell\ClaudeCodeAuto',
  'HKEY_CLASSES_ROOT\Directory\shell\ClaudeVSCodeAuto',
  'HKEY_CLASSES_ROOT\Directory\background\shell\ClaudeCode',
  'HKEY_CLASSES_ROOT\Directory\background\shell\ClaudeCodeAuto',
  'HKEY_CLASSES_ROOT\Directory\background\shell\ClaudeVSCodeAuto'
)
$present = $legacy | Where-Object { reg query $_ 2>$null | Out-Null; $LASTEXITCODE -eq 0 }
if ($present) {
  Write-Host "  legacy HKCR entries found - elevating to remove them..." -ForegroundColor Yellow
  $cmds = ($present | ForEach-Object { "reg delete `"$_`" /f" }) -join "`n"
  Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',$cmds
}

Write-Host "Done. (Launcher files under ~\.claude\ccm-launchers were left in place.)" -ForegroundColor Green
