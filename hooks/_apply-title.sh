#!/bin/bash
# Shared helper: apply a tab title to the REAL terminal.
# BUILD: 2026-07-09 v4 startup-glyph
#
# In a VS Code integrated terminal the hook's controlling tty IS the
# integrated-terminal pty, so a cheap OSC write to /dev/tty lands directly on
# the tab - no PowerShell process needed. Everywhere else (Windows Terminal,
# where hook subprocesses have no usable /dev/tty), fall back to the
# AttachConsole helper that walks the process tree.
#
# Override with CCM_TITLE_MODE=tty|ps|auto (default auto).
#
# Always returns 0. The title is cosmetic, and update-title.sh runs under
# `set -e` - a host where neither path works must not abort the hook.
apply_tab_title() {
  local title="$1"
  local mode="${CCM_TITLE_MODE:-auto}"

  if [ "$mode" != "ps" ]; then
    if { [ "$mode" = "tty" ] || [ "${TERM_PROGRAM:-}" = "vscode" ]; }; then
      # `-w` is not enough: with no controlling terminal /dev/tty is writable
      # yet open(2) still fails with ENXIO. Redirect stderr BEFORE /dev/tty so
      # bash reports that failure to /dev/null, not onto the user's screen.
      if printf '\033]0;%s\007' "$title" 2>/dev/null > /dev/tty; then
        return 0
      fi
    fi
  fi

  powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File "$HOME/.claude/skills/session-behavior/scripts/set-tab-title.ps1" \
    -Title "$title" >/dev/null 2>&1

  return 0
}
