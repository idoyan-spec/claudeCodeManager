<#
  bootstrap.ps1 - ONE command to install (or update) the whole Claude Code Manager
  environment on any Windows machine.

  This is the single entry point. Clone the repo, run this, done:

      git clone https://github.com/idoyan-spec/claudeCodeManager.git
      cd claudeCodeManager
      powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1

  What it does (every step idempotent - safe, and MEANT, to be re-run):
    0. Pulls the latest repo, so re-running is how you UPDATE to whatever we
       added since. (`-NoPull` skips this; a non-git copy just warns and goes on.)
    1. Installs Claude Code itself if it is missing (official installer). `-NoClaude` skips.
    2. Reports Node.js (needed only for the tests / the md2pdf CLI, not for the
       features themselves - the extension runs on VS Code's own Node).
    3. Checks that an Edge/Chrome exists for the Markdown->PDF export.
    4. Runs install.ps1        -> ccm command, VS Code settings, keybindings, hooks.
    5. Runs install-extension  -> the ccm-hub extension, which now also carries the
                                  RTL Markdown->PDF export button.

  Nothing here runs in the background, opens a port, or phones home. The only
  network calls are the git pull and (if Claude is missing) its official installer.

  BUILD: 2026-07-14 22:55 v18 md-rtl-pdf
#>
[CmdletBinding()]
param(
    [switch]$NoPull,     # do not `git pull` first (offline, or working on a branch)
    [switch]$NoClaude    # do not install Claude Code even if it is missing
)

$BUILD = '2026-07-14 22:55 v18 md-rtl-pdf'
$root  = Split-Path -Parent $PSScriptRoot
$warnings = 0

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN $m" -ForegroundColor Yellow; $script:warnings++ }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host ""
Write-Host "Claude Code Manager - bootstrap  ($BUILD)" -ForegroundColor White
Write-Host "Repo: $root"
Write-Host ""

# --- 0. Self-update --------------------------------------------------------
# Re-running after a `git pull` is the whole update story: pull, then re-install.
Info "[0/5] Update from git"
if ($NoPull) {
    Ok "skipped (-NoPull)"
} elseif (-not (Have 'git')) {
    Warn "git not found - cannot self-update. Install git, or update the files manually."
} elseif (-not (Test-Path (Join-Path $root '.git'))) {
    Warn "this folder is not a git clone - skipping update (copied files won't auto-update)."
} else {
    try {
        $before = (git -C $root rev-parse --short HEAD 2>$null)
        git -C $root pull --ff-only 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
        $after = (git -C $root rev-parse --short HEAD 2>$null)
        if ($before -eq $after) { Ok "already up to date ($after)" }
        else { Ok "updated $before -> $after" }
    } catch {
        Warn "git pull failed ($($_.Exception.Message)). Continuing with the local copy."
    }
}
Write-Host ""

# --- 1. Claude Code --------------------------------------------------------
Info "[1/5] Claude Code"
if (Have 'claude') {
    $v = (claude --version 2>$null)
    Ok "installed ($v)"
} elseif ($NoClaude) {
    Warn "not installed and -NoClaude was given - skipping."
} else {
    Info "       installing Claude Code (official installer: https://claude.ai/install.ps1)"
    try {
        Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
        if (Have 'claude') { Ok "Claude Code installed" }
        else { Warn "installer ran but 'claude' is still not on PATH - open a new terminal and check." }
    } catch {
        Warn "could not install Claude Code automatically ($($_.Exception.Message))."
        Warn "install it yourself:  irm https://claude.ai/install.ps1 | iex"
    }
}
Write-Host ""

# --- 2. Node.js (informational) --------------------------------------------
# The RTL PDF export runs inside VS Code's bundled Node, so end users do NOT need
# system Node. It is only needed to run the test suite or the md2pdf CLI directly.
Info "[2/5] Node.js (optional - tests / md2pdf CLI only)"
if (Have 'node') {
    Ok "installed ($(node --version 2>$null))"
} else {
    Warn "not found. The features work without it; to run tests/CLI install Node LTS from https://nodejs.org"
}
Write-Host ""

# --- 3. A browser for the PDF export ---------------------------------------
Info "[3/5] Browser for Markdown->PDF"
# Kept to Windows PowerShell 5.1 syntax (no ternary) so a fresh Win10 box runs it.
$pf   = $env:ProgramFiles
$pf86 = ${env:ProgramFiles(x86)}
$local = $env:LOCALAPPDATA
$candidates = @(
    (Join-Path $pf   'Google\Chrome\Application\chrome.exe'),
    (Join-Path $pf86 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $pf   'Microsoft\Edge\Application\msedge.exe')
)
if ($local) { $candidates += (Join-Path $local 'Google\Chrome\Application\chrome.exe') }
$browsers = @($candidates | Where-Object { $_ -and (Test-Path $_) })
if ($browsers.Count) {
    Ok "found $([System.IO.Path]::GetFileName($browsers[0])) - PDF export will work"
} else {
    Warn "no Chrome/Edge found. Edge ships with Windows 10/11; if it is missing, install Edge or Chrome."
}
Write-Host ""

# --- 4. ccm settings / keybindings / hooks ---------------------------------
Info "[4/5] ccm settings, keybindings, hooks (install.ps1)"
try {
    & (Join-Path $PSScriptRoot 'install.ps1')
} catch {
    Warn "install.ps1 failed: $($_.Exception.Message)"
}
Write-Host ""

# --- 5. The ccm-hub extension (RTL PDF button lives here) ------------------
Info "[5/5] ccm-hub VS Code extension (Alt+O picker, close-guard, RTL Markdown->PDF)"
try {
    & (Join-Path $root 'ccm-extension\install-extension.ps1')
} catch {
    Warn "install-extension.ps1 failed: $($_.Exception.Message)"
}
Write-Host ""

# --- Summary ---------------------------------------------------------------
if ($warnings -eq 0) {
    Write-Host "Bootstrap complete - no warnings." -ForegroundColor Green
} else {
    Write-Host "Bootstrap complete with $warnings warning(s) - see the yellow lines above." -ForegroundColor Yellow
}
Write-Host "RELOAD VS Code (or open a new window) so the 0.0.10 extension activates." -ForegroundColor White
Write-Host "Then: open any .md file and click the PDF button in the editor toolbar (top-right)." -ForegroundColor DarkGray
Write-Host "To UPDATE later on any machine, just run this script again." -ForegroundColor DarkGray
Write-Host "bootstrap build: $BUILD" -ForegroundColor DarkGray
