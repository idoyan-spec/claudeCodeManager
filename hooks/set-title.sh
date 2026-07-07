#!/bin/bash
# Set terminal window title.
# Usage:
#   set-title.sh                        -> "<dirname>"  (used by SessionStart hook)
#   set-title.sh "topic words"          -> "<dirname> - topic words"
#                                          and persists topic for the current session
#                                          (requires CLAUDE_SESSION_ID env or arg).
#   set-title.sh --session <id> "topic" -> persist under specific session id
dirname=$(basename "$(pwd)")

session_id=""
if [ "$1" = "--session" ]; then
  session_id="$2"
  shift 2
fi
if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
fi

topic="$*"

# Persist topic for this session so the UserPromptSubmit hook keeps using it.
if [ -n "$topic" ] && [ -n "$session_id" ]; then
  TOPIC_DIR="$HOME/.claude/skills/session-behavior/session-topics"
  mkdir -p "$TOPIC_DIR" 2>/dev/null
  printf '%s\n' "$topic" > "$TOPIC_DIR/$session_id.txt"
fi

if [ -n "$topic" ]; then
  title="$dirname - $topic"
else
  title="$dirname"
fi

# Debug log so we can confirm the hook fired.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] set-title cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title"

exit 0
