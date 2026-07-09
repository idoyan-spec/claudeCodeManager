#!/bin/bash
# Set terminal window title.
# BUILD: 2026-07-09 17:51 v8 tab-focus
#
# Usage:
#   set-title.sh                        -> "<model> ✓ <dirname>"  (SessionStart hook)
#   set-title.sh "topic words"          -> "<dirname> - topic words"
#                                          and persists topic for the current session
#   set-title.sh --session <id> "topic" -> persist under specific session id
#
# A fresh session is idle and waiting for you to type - the same state the Stop
# hook reports - so SessionStart paints "✓", not a blank status. Leaving it
# blank made every tab in a reopened window look unarmed until its first prompt.

dirname=$(basename "$(pwd)")

session_id=""
if [ "$1" = "--session" ]; then
  session_id="$2"
  shift 2
fi

topic="$*"

# Hooks receive their event JSON on stdin; a human running this by hand does not.
INPUT=""
if [ ! -t 0 ] && [ -z "$topic" ]; then INPUT=$(cat); fi

source "$HOME/.claude/skills/session-behavior/scripts/_model-glyph.sh"

if [ -z "$session_id" ]; then
  session_id=$(ccm_json_str "$INPUT" session_id)
fi
if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
fi
[ -n "$session_id" ] || session_id="default"

# Persist topic for this session so the UserPromptSubmit hook keeps using it.
if [ -n "$topic" ]; then
  TOPIC_DIR="$HOME/.claude/skills/session-behavior/session-topics"
  mkdir -p "$TOPIC_DIR" 2>/dev/null
  printf '%s\n' "$topic" > "$TOPIC_DIR/$session_id.txt"
fi

if [ -n "$topic" ]; then
  title="$dirname - $topic"
else
  # A resumed session already has assistant turns, so the transcript names the
  # model. A fresh one falls back to the configured model inside this helper.
  ccm_refresh_model_glyph "$session_id" "$(ccm_transcript_path "$INPUT")" || true
  title=$(ccm_title "✓" "$session_id" "$dirname")
fi

# Debug log so we can confirm the hook fired.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] set-title cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title"

exit 0
