# install-context-menu.ps1  |  BUILD: 2026-07-09 v1
# Registers two Explorer right-click entries for Claude Code. PORTABLE + NO ADMIN:
# writes to HKCU\Software\Classes (per-user), which Explorer merges into the menu.
#
#   "Open in Claude Code (Auto)"     -> Windows Terminal + Claude (auto mode)
#   "Open in Claude Code (VS Code)"  -> VS Code on the folder + a Claude terminal beside it
#
# Usage:   powershell -ExecutionPolicy Bypass -File .\install-context-menu.ps1
# Remove:  powershell -ExecutionPolicy Bypass -File .\uninstall-context-menu.ps1

$ErrorActionPreference = 'Stop'
$BUILD = '2026-07-09 v1'
Write-Host "ccm Explorer context-menu installer  (build $BUILD)" -ForegroundColor Cyan

# --- copy launchers to a stable per-user runtime location (independent of repo path) ---
$repoLaunchers = Join-Path $PSScriptRoot 'launchers'
$runtimeDir    = Join-Path $env:USERPROFILE '.claude\ccm-launchers'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item (Join-Path $repoLaunchers '*.vbs') $runtimeDir -Force
$termVbs = Join-Path $runtimeDir 'claude-terminal.vbs'
$hubVbs  = Join-Path $runtimeDir 'claude-hub.vbs'
Write-Host "  launchers -> $runtimeDir"

# --- detect VS Code (for the menu icon; launcher detects it again at runtime) ---
$vsCandidates = @(
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  "$env:ProgramFiles\Microsoft VS Code\Code.exe",
  "${env:ProgramFiles(x86)}\Microsoft VS Code\Code.exe"
)
$vsCode = $vsCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$vsIcon = if ($vsCode) { $vsCode } else { "$env:SystemRoot\System32\cmd.exe,0" }
$termIcon = "$env:SystemRoot\System32\cmd.exe,0"

# --- helper: create one shell verb under HKCU\Software\Classes ---
function Set-Verb {
    param($BaseKey, $Name, $Label, $Icon, $Command)
    $keyPath = "$BaseKey\$Name"
    New-Item -Path $keyPath -Force | Out-Null
    Set-ItemProperty -Path $keyPath -Name '(Default)' -Value $Label
    Set-ItemProperty -Path $keyPath -Name 'Icon'      -Value $Icon
    New-Item -Path "$keyPath\command" -Force | Out-Null
    Set-ItemProperty -Path "$keyPath\command" -Name '(Default)' -Value $Command
}

# "%1" = path when right-clicking ON a folder;  "%V" = path when right-clicking INSIDE a folder
$dirShell = 'HKCU:\Software\Classes\Directory\shell'
$bgShell  = 'HKCU:\Software\Classes\Directory\Background\shell'

# Auto (terminal only)
Set-Verb $dirShell 'ClaudeCodeAuto'  'Open in Claude Code (Auto)'    $termIcon "wscript.exe `"$termVbs`" `"%1`""
Set-Verb $bgShell  'ClaudeCodeAuto'  'Open in Claude Code (Auto)'    $termIcon "wscript.exe `"$termVbs`" `"%V`""

# VS Code (hub): new terminal INSIDE the current VS Code window, via the ccm-hub extension
Set-Verb $dirShell 'ClaudeCodeVSCode' 'Open in Claude Code (VS Code)' $vsIcon  "wscript.exe `"$hubVbs`" `"%1`""
Set-Verb $bgShell  'ClaudeCodeVSCode' 'Open in Claude Code (VS Code)' $vsIcon  "wscript.exe `"$hubVbs`" `"%V`""

Write-Host "Installed 2 menu entries (on-folder + inside-folder)." -ForegroundColor Green
Write-Host "VS Code detected at: $(if($vsCode){$vsCode}else{'NOT FOUND - launcher will fall back to PATH'})"
Write-Host "Right-click any folder to see: 'Open in Claude Code (Auto)' and 'Open in Claude Code (VS Code)'."
