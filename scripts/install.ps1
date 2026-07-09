<#
  install.ps1 - set up the Claude Code Manager "hub" environment.

  What it does (all idempotent - safe to run more than once):
    1. Registers the `ccm` command in your PowerShell profile.
    2. Merges the recommended VS Code terminal settings (makes a backup first).
    3. Deploys the session-behavior hooks and verifies CLAUDE_CODE_DISABLE_TERMINAL_TITLE.
    4. Merges the terminal focus keybindings into VS Code's keybindings.json.

  Nothing here runs in the background, opens a port, or phones home.

  BUILD: 2026-07-09 18:20 v9 active-tab-and-idle
#>
[CmdletBinding()]
param()

$BUILD = '2026-07-09 18:20 v9 active-tab-and-idle'
$root  = Split-Path -Parent $PSScriptRoot
$ccm   = Join-Path $PSScriptRoot 'ccm.ps1'

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
    'terminal.tab.activeBorder'        = '#ffb300'
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

if (Test-Path $claudeSettings) {
    $cs = Get-Content -LiteralPath $claudeSettings -Raw
    if ($cs -match 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE') {
        Write-Host "[3/4] CLAUDE_CODE_DISABLE_TERMINAL_TITLE is set - OK" -ForegroundColor Green
    } else {
        Write-Host "[3/4] WARNING: CLAUDE_CODE_DISABLE_TERMINAL_TITLE not found in ~/.claude/settings.json" -ForegroundColor Yellow
        $ok = $false
    }
} else {
    Write-Host "[3/4] WARNING: ~/.claude/settings.json not found" -ForegroundColor Yellow
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
$kbPath    = Join-Path $env:APPDATA 'Code\User\keybindings.json'
$kbSnippet = Join-Path $root 'vscode\keybindings-snippet.json'

$wantKb = @(
    [pscustomobject]@{ key = 'ctrl+down'; command = 'workbench.action.terminal.focusNext';     when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'ctrl+up';   command = 'workbench.action.terminal.focusPrevious'; when = 'terminalFocus && !terminalTabsFocus' }
    [pscustomobject]@{ key = 'down'; command = 'runCommands'; when = 'terminalTabsFocus'
                       args = [pscustomobject]@{ commands = @('list.focusDown','list.select','workbench.action.terminal.focus') } }
    [pscustomobject]@{ key = 'up';   command = 'runCommands'; when = 'terminalTabsFocus'
                       args = [pscustomobject]@{ commands = @('list.focusUp','list.select','workbench.action.terminal.focus') } }
)

if (-not (Test-Path $kbPath)) {
    New-Item -ItemType File -Path $kbPath -Force | Out-Null
    ($wantKb | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $kbPath -Encoding UTF8
    Write-Host "[4/4] Created keybindings.json with the terminal focus bindings." -ForegroundColor Green
} else {
    $kbRaw = Get-Content -LiteralPath $kbPath -Raw -ErrorAction SilentlyContinue
    $existing = $null
    if ([string]::IsNullOrWhiteSpace($kbRaw)) {
        $existing = @()
    } else {
        try { $existing = @($kbRaw | ConvertFrom-Json -ErrorAction Stop) } catch { $existing = $null }
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
        ($existing | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $kbPath -Encoding UTF8
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
