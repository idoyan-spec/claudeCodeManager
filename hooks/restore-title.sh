#!/bin/bash
# Re-apply the tab title (folder + status) after Claude Code renders.
#
# Called with a STATE argument that maps to a status glyph:
#   working    -> "⚙ <folder>"   Claude is busy (PostToolUse)
#   done       -> "✅ <folder>"   Claude finished, your turn (Stop)
#   attention  -> "🔔 <folder>"   Claude needs you now (Notification / permission)
#
# Legacy: "--force" is accepted and treated as "done".
#
# "working" is debounced (~2s) because PostToolUse fires after every tool and
# the PowerShell fallback costs ~500ms. "done"/"attention" always apply so the
# final state is never missed.

state="${1:-done}"
case "$state" in
  working)   emoji="⚙"; force=0 ;;
  done)      emoji="✅"; force=1 ;;
  attention) emoji="🔔"; force=1 ;;
  --force)   emoji="✅"; force=1 ;;
  *)         emoji="✅"; force=1 ;;
esac

session_id="${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
LAST_TITLE_DIR="$HOME/.claude/skills/session-behavior/last-titles"

if [ "$force" -ne 1 ]; then
  STAMP_FILE="$LAST_TITLE_DIR/${session_id:-default}.stamp"
  if [ -f "$STAMP_FILE" ]; then
    last_ms=$(cat "$STAMP_FILE" 2>/dev/null)
    now_ms=$(date +%s%3N 2>/dev/null || date +%s000)
    if [ -n "$last_ms" ] && [ -n "$now_ms" ]; then
      delta=$((now_ms - last_ms))
      if [ "$delta" -lt 2000 ] && [ "$delta" -ge 0 ]; then
        exit 0
      fi
    fi
  fi
  mkdir -p "$LAST_TITLE_DIR" 2>/dev/null
  date +%s%3N 2>/dev/null > "$STAMP_FILE" || date +%s000 > "$STAMP_FILE"
fi

dirname=$(basename "$(pwd)")
title="$emoji $dirname"

# Debug log.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] restore-title state=%s cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$state" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title"

exit 0
