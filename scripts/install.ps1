<#
  install.ps1 - set up the Claude Code Manager "hub" environment.

  What it does (all idempotent - safe to run more than once):
    1. Registers the `ccm` command in your PowerShell profile.
    2. Merges the recommended VS Code terminal settings (makes a backup first).
    3. Deploys the session-behavior hooks and verifies CLAUDE_CODE_DISABLE_TERMINAL_TITLE.
    4. Merges the terminal focus keybindings into VS Code's keybindings.json.

  Nothing here runs in the background, opens a port, or phones home.

  BUILD: 2026-07-12 20:45 v15 keycode-dispatch
#>
[CmdletBinding()]
param()

$BUILD = '2026-07-12 20:45 v15 keycode-dispatch'
$root  = Split-Path -Parent $PSScriptRoot
$ccm   = Join-Path $PSScriptRoot 'ccm.ps1'

# `Set-Content -Encoding UTF8` writes a BOM in Windows PowerShell, and a BOM in a
# JSON config is a coin-flip for whoever parses it. Always write JSON through these.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-JsonFile([string]$Path, $Value) {      # top-level ARRAY (keybindings)
    $json = ConvertTo-Json -InputObject @($Value) -Depth 10
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}
function Write-JsonObject([string]$Path, $Value) {    # top-level OBJECT (settings)
    $json = ConvertTo-Json -InputObject $Value -Depth 20
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

Write-Host ""
Write-Host "Claude Code Manager installer  ($BUILD)" -ForegroundColor Cyan
Write-Host "Project root: $root"
Write-Host ""

# --- 1. Register ccm in the PowerShell profile -----------------------------
$profilePath = $PROFILE.CurrentUserAllHosts
$marker = '# >>> claude-code-manager (ccm) >>>'
$endm   = '# <<< claude-code-manager (ccm) <<<'
$block  = "$marker`r`nfunction ccm { & '$ccm' @args }`r`n$endm"

if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Path $profilePath -Force | Out-Null
}
$profileText = Get-Content -LiteralPath $profilePath -Raw -ErrorAction SilentlyContinue
if ($profileText -and $profileText.Contains($marker)) {
    Write-Host "[1/4] ccm already registered in profile - OK" -ForegroundColor Green
} else {
    Add-Content -LiteralPath $profilePath -Value "`r`n$block`r`n"
    Write-Host "[1/4] Added ccm to profile:" -ForegroundColor Green
    Write-Host "      $profilePath"
    Write-Host "      (open a new terminal, or run: . `$PROFILE  to use ccm now)"
}

# --- 2. Merge VS Code terminal settings ------------------------------------
$settings = Join-Path $env:APPDATA 'Code\User\settings.json'
$snippet  = Join-Path $root 'vscode\settings-snippet.json'
$want = [ordered]@{
    'terminal.integrated.tabs.enabled'             = $true
    'terminal.integrated.tabs.location'            = 'left'
    'terminal.integrated.tabs.hideCondition'       = 'never'
    'terminal.integrated.tabs.title'               = '${sequence}'
    'terminal.integrated.tabs.showActiveTerminal'  = 'always'
    'terminal.integrated.tabs.focusMode'           = 'singleClick'
    'terminal.integrated.enablePersistentSessions' = $true
    'terminal.integrated.enableVisualBell'         = $true
    'terminal.integrated.bellDuration'             = 3000
    # Only honoured by a workspace that has no stored panel position. VS Code keeps
    # `workbench.panel.position` per workspace, so already-opened folders keep their
    # bottom panel until the ccm-hub extension converts them (once each).
    'workbench.panel.defaultLocation'              = 'top'
    # Load-bearing for Alt+O / Alt+Q. VS Code's default dispatch ("code") resolves a
    # letter binding like `alt+o` by finding the physical key that produces "o" on the
    # ACTIVE keyboard layout. With a Hebrew layout active no key produces "o", so the
    # binding is unresolvable and the keypress falls through to the shell — while
    # arrow-key bindings (Alt+Up/Down) keep working because they carry no character.
    # "keyCode" dispatches by the raw hardware key position (US layout) regardless of
    # the active layout, so alt+o always = the physical O key. Requires a window reload.
    'keyboard.dispatch'                            = 'keyCode'
}

# Merged separately: colorCustomizations is a nested object owned by the user,
# so we add our keys without discarding theirs.
#
# terminal.tab.activeBorder is the only terminal-tab-specific colour VS Code
# defines, and it is a thin line. The row fill comes from the global list.*
# colours, which also tint Explorer/Search selections - a deliberate trade.
# inactiveSelection* is the load-bearing one: while you type in the terminal the
# tab list is unfocused, so the selected row renders as an INACTIVE selection.
$wantColors = @{
    'terminal.tab.activeBorder'        = '#ff1a1a'
    'list.warningForeground'           = '#ff4d4d'
    'list.activeSelectionBackground'   = '#0a4a75'
    'list.activeSelectionForeground'   = '#ffffff'
    'list.inactiveSelectionBackground' = '#0a4a75'
    'list.inactiveSelectionForeground' = '#ffffff'
    'list.focusOutline'                = '#ffb300'
}

if (-not (Test-Path $settings)) {
    New-Item -ItemType File -Path $settings -Force | Out-Null
    Set-Content -LiteralPath $settings -Value '{}' -Encoding UTF8
}

$raw = Get-Content -LiteralPath $settings -Raw -ErrorAction SilentlyContinue
$obj = $null
if ($raw) { try { $obj = $raw | ConvertFrom-Json -ErrorAction Stop } catch { $obj = $null } }

if ($null -eq $obj) {
    Write-Host "[2/4] Could not auto-parse your settings.json (it may contain comments)." -ForegroundColor Yellow
    Write-Host "      Nothing was changed. Add these keys yourself - the snippet is here:" -ForegroundColor Yellow
    Write-Host "      $snippet"
} else {
    $stamp  = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $backup = "$settings.ccm-backup-$stamp"
    Copy-Item -LiteralPath $settings -Destination $backup -Force
    foreach ($k in $want.Keys) {
        $obj | Add-Member -NotePropertyName $k -NotePropertyValue $want[$k] -Force
    }

    $colors = $obj.'workbench.colorCustomizations'
    if ($null -eq $colors) { $colors = [pscustomobject]@{} }
    foreach ($k in $wantColors.Keys) {
        $colors | Add-Member -NotePropertyName $k -NotePropertyValue $wantColors[$k] -Force
    }
    $obj | Add-Member -NotePropertyName 'workbench.colorCustomizations' -NotePropertyValue $colors -Force

    ($obj | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $settings -Encoding UTF8
    Write-Host "[2/4] Merged terminal settings into VS Code." -ForegroundColor Green
    Write-Host "      Backup saved: $backup"
}

# --- 3. Deploy + verify the hooks & env var --------------------------------
$claudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
$hooksDir       = Join-Path $env:USERPROFILE '.claude\skills\session-behavior\scripts'
$repoHooks      = Join-Path $root 'hooks'
$ok = $true

# The hooks are the source of the tab title. Ship them, don't just check them -
# this is what makes the install portable to a second machine.
if (Test-Path $repoHooks) {
    New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null
    Copy-Item (Join-Path $repoHooks '*.sh')  $hooksDir -Force
    Copy-Item (Join-Path $repoHooks '*.ps1') $hooksDir -Force
    Write-Host "[3/4] hooks -> $hooksDir" -ForegroundColor Green
}

# Copying the scripts is not enough: nothing calls them until they are REGISTERED
# as hooks in ~/.claude/settings.json. Until v12 the installer shipped the files,
# warned about the env var, and registered nothing - so on a machine that had never
# been hand-configured, the tabs stayed bare and nothing said why. Everything below
# is matched on a signature substring, so re-running never appends a duplicate and a
# hook the user re-pointed elsewhere is left alone.
$hookCmd = 'bash "$HOME/.claude/skills/session-behavior/scripts/{0}"'   # $HOME stays literal: bash expands it
$wantHooks = @(
    @{ Event = 'SessionStart';     Cmd = ($hookCmd -f 'set-title.sh');                 Sig = 'set-title.sh' }
    @{ Event = 'UserPromptSubmit'; Cmd = ($hookCmd -f 'update-title.sh');              Sig = 'update-title.sh' }
    @{ Event = 'Stop';             Cmd = ($hookCmd -f 'restore-title.sh') + ' done';      Sig = 'restore-title.sh" done' }
    @{ Event = 'PostToolUse';      Cmd = ($hookCmd -f 'restore-title.sh') + ' working';   Sig = 'restore-title.sh" working' }
    @{ Event = 'Notification';     Cmd = ($hookCmd -f 'restore-title.sh') + ' attention'; Sig = 'restore-title.sh" attention' }
    # Audible alert alongside the red tab flash. The Windows directory is resolved by
    # .NET, not hardcoded to C:\Windows - and deliberately WITHOUT a `$` anywhere:
    # hook commands are handed to a shell that expands `$` (that is how `$HOME` above
    # works), so `$env:SystemRoot` would be eaten before powershell ever saw it.
    @{ Event = 'Notification'
       Cmd   = 'powershell -Command "(New-Object Media.SoundPlayer ([Environment]::GetFolderPath(''Windows'') + ''\Media\Alarm04.wav'')).PlaySync()"'
       Sig   = 'Media.SoundPlayer' }
)

if (Test-Path $claudeSettings) {
    $cs = Get-Content -LiteralPath $claudeSettings -Raw
    $cj = $null
    try { $cj = $cs | ConvertFrom-Json -ErrorAction Stop } catch { $cj = $null }

    if ($null -eq $cj) {
        Write-Host "[3/4] WARNING: could not parse ~/.claude/settings.json - left untouched." -ForegroundColor Yellow
        $ok = $false
    } else {
        Copy-Item -LiteralPath $claudeSettings `
                  -Destination "$claudeSettings.ccm-backup-$((Get-Date).ToString('yyyyMMdd-HHmmss'))" -Force
        $changed = @()

        # Claude Code writes its own OSC title and would overwrite ours. Read at startup.
        $envObj = $cj.env
        if ($null -eq $envObj) { $envObj = [pscustomobject]@{} }
        if (-not $envObj.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) {
            $envObj | Add-Member -NotePropertyName 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE' -NotePropertyValue '1' -Force
            $changed += 'env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE'
        }
        $cj | Add-Member -NotePropertyName 'env' -NotePropertyValue $envObj -Force

        # The tab flash needs a BEL byte on the pty. A hook cannot write one - it has
        # no controlling terminal. Claude Code can, because its stdout IS the pty.
        if ($cj.preferredNotifChannel -ne 'terminal_bell') {
            $cj | Add-Member -NotePropertyName 'preferredNotifChannel' -NotePropertyValue 'terminal_bell' -Force
            $changed += 'preferredNotifChannel'
        }

        $hooksObj = $cj.hooks
        if ($null -eq $hooksObj) { $hooksObj = [pscustomobject]@{} }
        foreach ($w in $wantHooks) {
            $groups = @()
            foreach ($g in @($hooksObj.($w.Event))) { if ($null -ne $g) { $groups += $g } }

            $found = $false
            foreach ($g in $groups) {
                foreach ($h in @($g.hooks)) {
                    if ($null -ne $h -and $h.command -like "*$($w.Sig)*") { $found = $true }
                }
            }
            if (-not $found) {
                $groups += [pscustomobject]@{
                    matcher = '*'
                    hooks   = @([pscustomobject]@{ type = 'command'; command = $w.Cmd; timeout = 5 })
                }
                $hooksObj | Add-Member -NotePropertyName $w.Event -NotePropertyValue $groups -Force
                $changed += "hooks.$($w.Event)"
            }
        }
        $cj | Add-Member -NotePropertyName 'hooks' -NotePropertyValue $hooksObj -Force

        if ($changed.Count -gt 0) {
            Write-JsonObject $claudeSettings $cj
            $shown = @($changed | Select-Object -Unique)   # Notification carries two hooks
            Write-Host "[3/4] ~/.claude/settings.json updated: $($shown -join ', ')" -ForegroundColor Green
            Write-Host "      (takes effect in a NEW Claude session)"
        } else {
            Write-Host "[3/4] env + hooks + preferredNotifChannel already registered - OK" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[3/4] WARNING: ~/.claude/settings.json not found - start Claude Code once, then re-run." -ForegroundColor Yellow
    $ok = $false
}
foreach ($f in 'set-title.sh','update-title.sh','restore-title.sh','_apply-title.sh','_model-glyph.sh','set-tab-title.ps1') {
    if (-not (Test-Path (Join-Path $hooksDir $f))) {
        Write-Host "      MISSING hook script: $f" -ForegroundColor Yellow
        $ok = $false
    }
}

# --- 4. Merge the terminal focus keybindings -------------------------------
# Matched on key+command+when, so re-running never appends a duplicate and a
# binding the user re-pointed at another command is left alone.
#
# Two traps, both hit for real:
#   * `@($raw | ConvertFrom-Json)` does NOT reliably unroll a JSON array - it can
#     hand back the array as a SINGLE object. That object has no `.key`, so the
#     dedupe matched nothing, all four bindings were appended, and the array got
#     re-serialised as `{"value":[...],"Count":4}` inside the file. Unroll with
#     a foreach and keep only elements that actually look like a keybinding.
#   * `Set-Content -Encoding UTF8` writes a BOM in Windows PowerShell. Write the
#     file with a no-BOM UTF8 encoder instead.
$kbPath    = Join-Path $env:APPDATA 'Code\User\keybindings.json'
$kbSnippet = Join-Path $root 'vscode\keybindings-snippet.json'

# Ctrl and Alt are both bound to the terminal-switch commands: the user reached for
# Alt, found nothing, and reported the feature dead. Two keys, one command, no ambiguity.
# Both survive the terminal because focusNext/focusPrevious ship in the default
# `terminal.integrated.commandsToSkipShell`; a command outside that list would be
# swallowed by the shell instead of reaching VS Code.
$wantKb = @(
    [pscustomobject]@{ key = 'ctrl+down'; command = 'workbench.action.terminal.focusNext';     when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'ctrl+up';   command = 'workbench.action.terminal.focusPrevious'; when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'alt+down';  command = 'workbench.action.terminal.focusNext';     when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'alt+up';    command = 'workbench.action.terminal.focusPrevious'; when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'down'; command = 'runCommands'; when = 'terminalTabsFocus'
                       args = [pscustomobject]@{ commands = @('list.focusDown','list.select','workbench.action.terminal.focus') } }
    [pscustomobject]@{ key = 'up';   command = 'runCommands'; when = 'terminalTabsFocus'
                       args = [pscustomobject]@{ commands = @('list.focusUp','list.select','workbench.action.terminal.focus') } }
)

if (-not (Test-Path $kbPath)) {
    New-Item -ItemType File -Path $kbPath -Force | Out-Null
    Write-JsonFile $kbPath $wantKb
    Write-Host "[4/4] Created keybindings.json with the terminal focus bindings." -ForegroundColor Green
} else {
    $kbRaw = (Get-Content -LiteralPath $kbPath -Raw -ErrorAction SilentlyContinue) -replace "^﻿", ''
    $existing = $null
    if ([string]::IsNullOrWhiteSpace($kbRaw)) {
        $existing = @()
    } else {
        try {
            $parsed = ConvertFrom-Json -InputObject $kbRaw -ErrorAction Stop
            # Unroll explicitly, and drop anything that is not a keybinding object.
            $existing = @()
            foreach ($e in @($parsed)) {
                if ($null -ne $e -and $e.PSObject.Properties.Name -contains 'key') { $existing += $e }
            }
        } catch { $existing = $null }
    }

    if ($null -eq $existing) {
        Write-Host "[4/4] Could not auto-parse keybindings.json (it may contain comments)." -ForegroundColor Yellow
        Write-Host "      Nothing was changed. Add the bindings yourself - the snippet is here:" -ForegroundColor Yellow
        Write-Host "      $kbSnippet"
    } else {
        $stamp  = (Get-Date).ToString('yyyyMMdd-HHmmss')
        Copy-Item -LiteralPath $kbPath -Destination "$kbPath.ccm-backup-$stamp" -Force
        $added = 0
        foreach ($kb in $wantKb) {
            $dup = $existing | Where-Object { $_.key -eq $kb.key -and $_.command -eq $kb.command -and $_.when -eq $kb.when }
            if (-not $dup) { $existing += $kb; $added++ }
        }
        Write-JsonFile $kbPath $existing
        Write-Host "[4/4] Merged $added keybinding(s) into keybindings.json." -ForegroundColor Green
    }
}

Write-Host ""
if ($ok) {
    Write-Host "Done. Open a NEW VS Code window and start sessions with:  ccm <path>" -ForegroundColor Cyan
} else {
    Write-Host "Done with warnings - see the yellow lines above." -ForegroundColor Yellow
}
Write-Host "Remember: the title/status change only takes effect in a NEW Claude window." -ForegroundColor DarkGray
