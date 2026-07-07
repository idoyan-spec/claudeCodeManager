<#
  ccm.ps1 - Claude Code Manager launcher
  Opens a folder as a Claude Code session in the CURRENT VS Code terminal tab,
  naming the tab after the folder so the vertical tab list stays readable.

  BUILD: 2026-07-07 v1 vscode-hub
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Path,
    [switch]$Version,
    [switch]$Help
)

$BUILD = '2026-07-07 v1 vscode-hub'

function Set-TabTitle([string]$Text) {
    # OSC 0 ; <text> BEL  -> sets the terminal tab/window title.
    # In a VS Code integrated terminal, stdout here IS the pty, so this
    # lands directly on the tab.
    $esc = [char]27
    $bel = [char]7
    [Console]::Write("$esc]0;$Text$bel")
}

if ($Version) { Write-Host "ccm $BUILD"; return }

if ($Help -or [string]::IsNullOrWhiteSpace($Path)) {
    Write-Host @"
ccm - Claude Code Manager  ($BUILD)

Usage:
  ccm <path>      Open <path> as a Claude Code session in THIS tab
                  (names the tab after the folder, then launches claude)
  ccm --version   Show the build stamp
  ccm --help      Show this help

Tip: open a NEW terminal tab in your VS Code hub (Ctrl+Shift+5),
     then run  ccm <path>  in it.
"@
    return
}

$resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Error "ccm: path not found -> $Path"
    return
}
$dir  = $resolved.Path
$name = Split-Path -Leaf $dir

Set-Location -LiteralPath $dir
Set-TabTitle $name
Write-Host "ccm $BUILD  |  $name  ->  $dir" -ForegroundColor Cyan

# Hand off to Claude Code. From here the session-behavior hooks own the tab
# title (folder + live status).
claude
