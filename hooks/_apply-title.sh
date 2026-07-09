#!/bin/bash
# Shared helper: apply a tab title to the REAL terminal.
# BUILD: 2026-07-09 v5 tty-first
#
# The hook's controlling tty IS the terminal's pty, so an OSC write to /dev/tty
# lands on the tab with no helper process. That is true in a VS Code integrated
# terminal (where `terminal.integrated.tabs.title: "${sequence}"` renders it) and
# it costs nothing to attempt anywhere else.
#
# So: always TRY the tty first, and fall back to the AttachConsole helper only
# when the write actually fails. Until v5 the tty branch was gated on
# `TERM_PROGRAM = vscode`. That variable is NOT set in the hook's environment
# here, so VS Code silently took the PowerShell fallback - which walks the
# process tree looking for WindowsTerminal, never finds it under Code.exe, and
# paints nothing. The tab then falls back to the extension's
# `createTerminal({name})`, i.e. a bare folder name. Probe, don't presume.
#
# Override with CCM_TITLE_MODE=tty|ps|auto (default auto).
#
# Always returns 0. The title is cosmetic, and update-title.sh runs under
# `set -e` - a host where neither path works must not abort the hook.
apply_tab_title() {
  local title="$1"
  local mode="${CCM_TITLE_MODE:-auto}"
  local log="$HOME/.claude/skills/session-behavior/set-title.log"
  local via="none"

  if [ "$mode" != "ps" ]; then
    # `-w /dev/tty` is not a valid test: with no controlling terminal the device
    # is writable yet open(2) still fails with ENXIO. Just attempt the write.
    # Redirect stderr BEFORE /dev/tty, or bash reports that failure to the
    # user's screen instead of to /dev/null (redirections apply left to right).
    if printf '\033]0;%s\007' "$title" 2>/dev/null > /dev/tty; then
      via="tty"
    fi
  fi

  if [ "$via" = "none" ] && [ "$mode" != "tty" ]; then
    if powershell.exe -NoProfile -ExecutionPolicy Bypass \
        -File "$HOME/.claude/skills/session-behavior/scripts/set-tab-title.ps1" \
        -Title "$title" >/dev/null 2>&1; then
      via="ps"
    else
      via="failed"
    fi
  fi

  printf '[%s] apply via=%s mode=%s TERM_PROGRAM=[%s] title=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$via" "$mode" "${TERM_PROGRAM:-}" "$title" \
    >> "$log" 2>/dev/null

  return 0
}
