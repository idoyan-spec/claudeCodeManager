#!/bin/bash
# UserPromptSubmit hook script.
# Reads JSON from stdin ({ session_id, cwd, prompt/message, ... }),
# then re-sets the WT tab title to "<dirname> - <topic>".
#
# Topic precedence:
#   1. If a per-session topic file exists, use its contents.
#   2. Otherwise fall back to the first 50 chars of the prompt.
#
# Important: do NOT write OSC sequences or debug text to stdout —
# UserPromptSubmit stdout is appended to Claude's context.

set -e

INPUT=$(cat)

# Extract session_id and prompt text from the JSON using minimal regex.
# (Git Bash on Windows may not have jq.)
session_id=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
prompt=$(printf '%s' "$INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)"$/\1/')
if [ -z "$prompt" ]; then
  prompt=$(printf '%s' "$INPUT" | grep -o '"message"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"message"[[:space:]]*:[[:space:]]*"\(.*\)"$/\1/')
fi

TOPIC_DIR="$HOME/.claude/skills/session-behavior/session-topics"
mkdir -p "$TOPIC_DIR" 2>/dev/null
TOPIC_FILE="$TOPIC_DIR/${session_id:-default}.txt"

if [ -f "$TOPIC_FILE" ]; then
  topic=$(head -1 "$TOPIC_FILE")
else
  # Truncate prompt to ~50 chars, single line.
  topic=$(printf '%s' "$prompt" | tr '\n' ' ' | tr -s ' ' | cut -c1-50)
fi

dirname=$(basename "$(pwd)")
# Folder name only (no topic suffix) + a "working" status glyph: the user just
# submitted a prompt, so Claude is now busy.
title="⚙ $dirname"

# Cache the computed title so the Stop hook can re-apply it after Claude Code
# re-sets the title with its own OSC sequence.
LAST_TITLE_DIR="$HOME/.claude/skills/session-behavior/last-titles"
mkdir -p "$LAST_TITLE_DIR" 2>/dev/null
printf '%s' "$title" > "$LAST_TITLE_DIR/${session_id:-default}.txt"

# Debug log so we can confirm the hook fired and see what was set.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] update-title cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title"

# Output nothing to stdout (so we don't pollute Claude's context).
exit 0
