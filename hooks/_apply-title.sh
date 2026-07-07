#!/bin/bash
# Shared helper: apply a tab title to the REAL terminal.
#
# In a VS Code integrated terminal the hook's controlling tty IS the
# integrated-terminal pty, so a cheap OSC write to /dev/tty lands directly on
# the tab - no PowerShell process needed. Everywhere else (Windows Terminal,
# where hook subprocesses have no usable /dev/tty), fall back to the
# AttachConsole helper that walks the process tree.
#
# Override with CCM_TITLE_MODE=tty|ps|auto (default auto).
apply_tab_title() {
  local title="$1"
  local mode="${CCM_TITLE_MODE:-auto}"

  if [ "$mode" != "ps" ]; then
    if { [ "$mode" = "tty" ] || [ "${TERM_PROGRAM:-}" = "vscode" ]; } && [ -w /dev/tty ]; then
      if printf '\033]0;%s\007' "$title" > /dev/tty 2>/dev/null; then
        return 0
      fi
    fi
  fi

  powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File "$HOME/.claude/skills/session-behavior/scripts/set-tab-title.ps1" \
    -Title "$title" >/dev/null 2>&1
}
