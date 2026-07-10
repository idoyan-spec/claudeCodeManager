#!/bin/bash
# Shared helper: apply a tab title to the REAL terminal.
# BUILD: 2026-07-10 09:04 v14 close-guard
#
# Two paths, tried in order: an OSC write to /dev/tty, else the AttachConsole
# helper (SetConsoleTitle; ConPTY forwards it to VS Code as `${sequence}`).
#
# MEASURED: the tty path never succeeds under Claude Code. Hooks are spawned with
# piped stdio and no controlling terminal, so open("/dev/tty") fails with ENXIO -
# in VS Code and in Windows Terminal alike. Every real hook logs `via=ps`. It is
# still attempted first: one cheap printf, and it is the right answer on a host
# that does hand a hook a tty. Do not re-gate it on `TERM_PROGRAM = vscode`; that
# variable *is* set inside VS Code, which made the dead branch look load-bearing.
#
# The `via=` field below exists so the next person reads the log instead of
# guessing. Guessing cost two wrong fixes.
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
