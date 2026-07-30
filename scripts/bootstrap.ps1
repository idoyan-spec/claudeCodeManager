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
    5. Runs install-extension  -> the ccm-hub extension (Alt+O/Alt+Q/Alt+E, RTL PDF).
    6. Installs the VS Code extensions Ido works with: Claude Code itself,
       RTL for VS Code Agents (Hebrew right-to-left in the Claude chat,
       side-loaded from its public GitHub repo), and Markdown PDF.
    7. Installs/updates the Voice-to-Claude dictation tool (separate repo,
       cloned as a sibling folder): Python deps + autostart service. `-NoVoice` skips.
    8. API keys: if this machine has no key source for the explain feature, PROMPTS
       the machine's owner for their own Gemini key and stores it ENCRYPTED in
       Windows Credential Manager. Never written to a plaintext file.
    9. Registers a hidden Task Scheduler job that re-runs this script silently
       (at logon + every 12h), so every machine keeps itself up to date with
       whatever Ido pushes. `-NoAutoUpdate` skips.

  Nothing here runs in the background except the auto-update task, which only does
  `git pull` + this same idempotent install. No ports, no telemetry. The only other
  network calls are the git pulls and (if Claude is missing) its official installer.

  Both repos are PUBLIC (MIT license) - cloning and pulling needs no GitHub
  account, no login, no invitation. Only Ido's account can push changes.

  BUILD: 2026-07-30 11:58 v26 vscode-extensions
#>
[CmdletBinding()]
param(
    [switch]$NoPull,        # do not `git pull` first (offline, or working on a branch)
    [switch]$NoClaude,      # do not install Claude Code even if it is missing
    [switch]$NoVoice,       # skip the Voice-to-Claude dictation tool entirely
    [switch]$NoAutoUpdate,  # do not register the self-update scheduled task
    [switch]$Silent         # non-interactive (used by the auto-update task): never prompts
)

$BUILD = '2026-07-30 11:58 v26 vscode-extensions'
$root  = Split-Path -Parent $PSScriptRoot
$warnings = 0

# In silent (scheduled) mode everything goes to a log so failures are diagnosable.
if ($Silent) {
    $logDir = Join-Path $env:LOCALAPPDATA 'ccm'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    try { Start-Transcript -Path (Join-Path $logDir 'bootstrap-update.log') -Force | Out-Null } catch {}
}

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN $m" -ForegroundColor Yellow; $script:warnings++ }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Windows Credential Manager (generic credentials, DPAPI-encrypted, current user).
# Write() is how a non-Ido machine stores its owner's own API key; Exists() lets us
# detect every key source without ever printing a secret.
if (-not ([System.Management.Automation.PSTypeName]'CcmCred').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CcmCred {
    [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CredReadW(string target, int type, int flag, out IntPtr pCred);
    [DllImport("Advapi32.dll", SetLastError=true)]
    static extern void CredFree(IntPtr pCred);
    [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags; public uint Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
        public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    public static bool Exists(string target) {
        IntPtr p; if (!CredReadW(target, 1, 0, out p)) return false; CredFree(p); return true;
    }
    public static void Write(string target, string secret) {
        byte[] blob = System.Text.Encoding.Unicode.GetBytes(secret);
        IntPtr pBlob = Marshal.AllocHGlobal(blob.Length);
        Marshal.Copy(blob, 0, pBlob, blob.Length);
        try {
            CREDENTIAL c = new CREDENTIAL();
            c.Type = 1; c.TargetName = target; c.CredentialBlobSize = (uint)blob.Length;
            c.CredentialBlob = pBlob; c.Persist = 2; c.UserName = "api";
            if (!CredWriteW(ref c, 0)) throw new Exception("CredWrite failed, error " + Marshal.GetLastWin32Error());
        } finally { Marshal.FreeHGlobal(pBlob); }
    }
}
"@
}

function Update-GitRepo($dir, $label) {
    if (-not (Have 'git')) { Warn "git not found - cannot update $label."; return }
    if (-not (Test-Path (Join-Path $dir '.git'))) {
        Warn "$label is not a git clone - skipping update (copied files won't auto-update)."
        return
    }
    try {
        $before = (git -C $dir rev-parse --short HEAD 2>$null)
        git -C $dir pull --ff-only 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
        $after = (git -C $dir rev-parse --short HEAD 2>$null)
        if ($before -eq $after) { Ok "$label already up to date ($after)" }
        else { Ok "$label updated $before -> $after" }
    } catch {
        Warn "git pull of $label failed ($($_.Exception.Message)). Continuing with the local copy."
    }
}

Write-Host ""
Write-Host "Claude Code Manager - bootstrap  ($BUILD)" -ForegroundColor White
Write-Host "Repo: $root"
Write-Host ""

# --- 0. Self-update --------------------------------------------------------
# Re-running after a `git pull` is the whole update story: pull, then re-install.
Info "[0/9] Update from git"
if ($NoPull) { Ok "skipped (-NoPull)" }
else { Update-GitRepo $root "claudeCodeManager" }
Write-Host ""

# --- 1. Claude Code --------------------------------------------------------
Info "[1/9] Claude Code"
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
Info "[2/9] Node.js (optional - tests / md2pdf CLI only)"
if (Have 'node') {
    Ok "installed ($(node --version 2>$null))"
} else {
    Warn "not found. The features work without it; to run tests/CLI install Node LTS from https://nodejs.org"
}
Write-Host ""

# --- 3. A browser for the PDF export ---------------------------------------
Info "[3/9] Browser for Markdown->PDF"
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
Info "[4/9] ccm settings, keybindings, hooks (install.ps1)"
try {
    & (Join-Path $PSScriptRoot 'install.ps1')
} catch {
    Warn "install.ps1 failed: $($_.Exception.Message)"
}
Write-Host ""

# --- 5. The ccm-hub extension ----------------------------------------------
Info "[5/9] ccm-hub VS Code extension (Alt+O picker, close-guard, Alt+E browser, RTL PDF)"
try {
    & (Join-Path $root 'ccm-extension\install-extension.ps1')
} catch {
    Warn "install-extension.ps1 failed: $($_.Exception.Message)"
}
Write-Host ""

# --- 6. VS Code extensions ---------------------------------------------------
# The rest of the toolkit used inside VS Code: the Claude Code extension itself,
# RTL for VS Code Agents (Hebrew right-to-left in the Claude chat; not on the
# marketplace, so side-loaded from its public GitHub repo the same way ccm-hub
# is), and Markdown PDF. Marketplace ones are install-if-missing only - VS Code
# keeps them updated by itself afterwards.
Info "[6/9] VS Code extensions (Claude Code, RTL Hebrew, Markdown PDF)"
if (-not (Have 'code')) {
    Warn "the 'code' command is not on PATH - open VS Code once, run 'Shell Command: Install code command in PATH', then re-run bootstrap."
} else {
    $installed = @(code --list-extensions 2>$null)
    foreach ($ext in @('anthropic.claude-code', 'yzane.markdown-pdf')) {
        if ($installed -contains $ext) {
            Ok "$ext already installed"
        } else {
            code --install-extension $ext 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
            if ($LASTEXITCODE -eq 0) { Ok "$ext installed" } else { Warn "could not install $ext - see above." }
        }
    }

    # RTL for VS Code Agents (GuyRonnen, GPL-3.0, github.com/GuyRonnen/rtl-for-vs-code-agents).
    # Buildless plain-JS extension: cloning it and copying into the extensions
    # folder IS the install (same mechanism as install-extension.ps1 for ccm-hub).
    $extRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
    $rtlHere = @(Get-ChildItem -Path $extRoot -Directory -Filter '*rtl-for-vs-code-agents*' -ErrorAction SilentlyContinue)
    if ($rtlHere.Count) {
        Ok "RTL for VS Code Agents already installed ($($rtlHere[0].Name))"
    } elseif (-not (Have 'git')) {
        Warn "git not found - cannot fetch the RTL extension; Hebrew in the Claude chat will render left-to-right."
    } else {
        $tmp = Join-Path $env:TEMP "ccm-rtl-ext-$PID"
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        git clone --depth 1 https://github.com/GuyRonnen/rtl-for-vs-code-agents.git $tmp 2>&1 |
            ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
        $pkgPath = Join-Path $tmp 'package.json'
        if (Test-Path $pkgPath) {
            $pkg  = Get-Content $pkgPath -Raw | ConvertFrom-Json
            $dest = Join-Path $extRoot "local.$($pkg.name)-$($pkg.version)"
            New-Item -ItemType Directory -Force -Path $extRoot | Out-Null
            Remove-Item (Join-Path $tmp '.git') -Recurse -Force -ErrorAction SilentlyContinue
            Copy-Item $tmp $dest -Recurse -Force
            Ok "RTL for VS Code Agents $($pkg.version) side-loaded -> $dest"
        } else {
            Warn "could not fetch the RTL extension (network problem?). Re-run bootstrap to retry."
        }
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host ""

# --- 7. Voice-to-Claude dictation tool --------------------------------------
# Separate private repo. Transcription is LOCAL (faster-whisper) - no key, no cloud.
# Lives as a sibling folder of this repo; the folder name differs between machines
# (Hebrew on the original machine), so we find it by its files, not by its name.
Info "[7/9] Voice-to-Claude dictation tool (Right Ctrl push-to-talk)"
if ($NoVoice) {
    Ok "skipped (-NoVoice)"
} else {
    $parent = Split-Path -Parent $root
    $voiceDir = $null
    foreach ($d in (Get-ChildItem -Directory $parent -ErrorAction SilentlyContinue)) {
        if (Test-Path (Join-Path $d.FullName 'voice_service.py')) { $voiceDir = $d.FullName; break }
    }
    if ($voiceDir) {
        Ok "found at $voiceDir"
        if (-not $NoPull) { Update-GitRepo $voiceDir "voice-to-claude" }
    } elseif (-not (Have 'git')) {
        Warn "git not found - cannot clone voice-to-claude."
    } else {
        $voiceDir = Join-Path $parent 'voice-to-claude'
        Info "       cloning https://github.com/idoyan-spec/voice-to-claude.git -> $voiceDir"
        git clone https://github.com/idoyan-spec/voice-to-claude.git $voiceDir 2>&1 |
            ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
        if (Test-Path (Join-Path $voiceDir 'voice_service.py')) { Ok "cloned" }
        else {
            Warn "clone failed - the repo is public, so this is usually a network problem."
            Warn "Check the internet connection and re-run bootstrap."
            $voiceDir = $null
        }
    }

    if ($voiceDir) {
        # Python 3.10+ is the tool's only system prerequisite.
        $pyOk = $false
        if (Have 'python') {
            $pv = (python --version 2>&1)
            if ($pv -match 'Python (\d+)\.(\d+)') {
                if ([int]$Matches[1] -gt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10)) { $pyOk = $true }
            }
            if ($pyOk) { Ok "Python: $pv" } else { Warn "Python too old ($pv) - need 3.10+." }
        }
        if (-not $pyOk -and -not $Silent -and (Have 'winget')) {
            Info "       Python 3.10+ not found - installing via winget (this can take a few minutes)"
            winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements 2>&1 |
                ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
            # winget edits PATH for future shells; try the freshly installed launcher for this one.
            if (Have 'python') { $pyOk = $true; Ok "Python installed" }
            else { Warn "Python installed but not on PATH yet - open a NEW terminal and re-run bootstrap." }
        } elseif (-not $pyOk) {
            Warn "Python 3.10+ missing. Install it (https://python.org or 'winget install Python.Python.3.12') and re-run."
        }

        if ($pyOk) {
            Info "       installing Python dependencies (first run downloads the Whisper model later, on first dictation)"
            python -m pip install --quiet --disable-pip-version-check -r (Join-Path $voiceDir 'requirements.txt') 2>&1 |
                ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
            if ($LASTEXITCODE -eq 0) { Ok "dependencies installed" } else { Warn "pip install reported errors - see above." }
            Push-Location $voiceDir
            try {
                python autostart.py install 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
                if ($LASTEXITCODE -eq 0) { Ok "dictation service registered (starts at logon, self-heals every minute)" }
                else { Warn "autostart.py install reported errors - see above." }
            } finally { Pop-Location }
        }
    }
}
Write-Host ""

# --- 8. API key for the explain-selection feature ---------------------------
# Dictation itself is fully local and needs NO key. Only the "explain selected
# terminal text in plain Hebrew" card calls Google Gemini. Key sources, in the
# order explain.py resolves them: env var -> Credential Manager -> bws (Ido's
# machine). On a machine with none of those we ask its OWNER for their own key.
Info "[8/9] Gemini API key (explain-selection feature only)"
if ($env:GEMINI_API_KEY) {
    Ok "GEMINI_API_KEY environment variable is set"
} elseif ([CcmCred]::Exists('GEMINI_API_KEY')) {
    Ok "stored in Windows Credential Manager (encrypted)"
} elseif ((Have 'bws') -and [CcmCred]::Exists('BWS_ACCESS_TOKEN')) {
    Ok "using Bitwarden Secrets Manager (bws)"
} elseif ($Silent) {
    Warn "no Gemini key configured - the explain card is disabled. Run bootstrap interactively once to set it."
} else {
    Write-Host "       The 'explain selected text' card uses Google Gemini and needs YOUR OWN free API key." -ForegroundColor White
    Write-Host "       Get one at:  https://aistudio.google.com/apikey   (dictation works fine WITHOUT it)" -ForegroundColor White
    $sec = Read-Host "       Paste your Gemini API key (or press Enter to skip)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($key -and $key.Trim()) {
        try {
            [CcmCred]::Write('GEMINI_API_KEY', $key.Trim())
            Ok "saved to Windows Credential Manager (encrypted, this Windows user only - never a plaintext file)"
        } catch { Warn "could not save the key: $($_.Exception.Message)" }
    } else {
        Warn "skipped - dictation still works; re-run bootstrap any time to add the key."
    }
}
Write-Host ""

# --- 9. Auto-update task ----------------------------------------------------
# "When Ido pushes, every machine picks it up": a hidden per-user task re-runs this
# script with -Silent (git pull + idempotent re-install) at logon and every 12h.
# Same proven XML shape as the voice tool's watchdog task (element order matters -
# schtasks rejects reordered children). IgnoreNew keeps overlapping runs impossible.
Info "[9/9] Auto-update task (pulls + re-installs at logon and every 12h)"
if ($NoAutoUpdate) {
    Ok "skipped (-NoAutoUpdate)"
} else {
    $taskName = 'ClaudeCodeManagerUpdate'
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $scriptPath = Join-Path $PSScriptRoot 'bootstrap.ps1'
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Claude Code Manager auto-update: git pull + idempotent re-install of the whole environment.</Description>
    <URI>\$taskName</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$user</UserId>
      <Delay>PT2M</Delay>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT12H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$user</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$scriptPath" -Silent</Arguments>
      <WorkingDirectory>$root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
    $tmpXml = Join-Path $env:TEMP 'ccm-update-task.xml'
    $xml | Out-File -Encoding Unicode $tmpXml   # schtasks only accepts UTF-16 XML
    $out = schtasks /Create /TN $taskName /XML $tmpXml /F 2>&1
    Remove-Item $tmpXml -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0) {
        Ok "task '$taskName' registered - this machine now updates itself (log: %LOCALAPPDATA%\ccm\bootstrap-update.log)"
    } else {
        Warn "could not register the auto-update task: $out"
        Warn "updates still work manually - just re-run this script."
    }
}
Write-Host ""

# --- Summary ---------------------------------------------------------------
if ($warnings -eq 0) {
    Write-Host "Bootstrap complete - no warnings." -ForegroundColor Green
} else {
    Write-Host "Bootstrap complete with $warnings warning(s) - see the yellow lines above." -ForegroundColor Yellow
}
Write-Host "RELOAD VS Code (or open a new window) so the extension activates." -ForegroundColor White
Write-Host "Dictation: hold RIGHT CTRL anywhere and speak; release to paste the transcript." -ForegroundColor DarkGray
Write-Host "To UPDATE later on any machine: automatic (logon / every 12h), or just re-run this script." -ForegroundColor DarkGray
Write-Host "bootstrap build: $BUILD" -ForegroundColor DarkGray
if ($Silent) { try { Stop-Transcript | Out-Null } catch {} }
