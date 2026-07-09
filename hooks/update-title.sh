#!/bin/bash
# UserPromptSubmit hook script.
# BUILD: 2026-07-09 v5 tty-first
#
# Reads JSON from stdin ({ session_id, transcript_path, cwd, prompt, ... }) and
# sets the tab title to "<model square> <status> <folder>". The user just
# submitted a prompt, so the status is "working".
#
# Important: do NOT write OSC sequences or debug text to stdout -
# UserPromptSubmit stdout is appended to Claude's context.

set -e

INPUT=$(cat)

source "$HOME/.claude/skills/session-behavior/scripts/_model-glyph.sh"

session_id=$(ccm_json_str "$INPUT" session_id)
[ -n "$session_id" ] || session_id="default"

# The transcript's last assistant turn tells us the model. On the very first
# prompt there is none yet, so the square simply appears from the next turn on
# (the Stop hook refreshes it authoritatively). `|| true` matters: this script
# runs under `set -e`, and a missing model must not abort the title update.
if [ -z "$(ccm_model_glyph "$session_id")" ]; then
  ccm_refresh_model_glyph "$session_id" "$(ccm_transcript_path "$INPUT")" || true
fi

dirname=$(basename "$(pwd)")
title=$(ccm_title "⟳" "$session_id" "$dirname")

# Cache the computed title so the Stop hook can re-apply it after Claude Code
# re-sets the title with its own OSC sequence.
LAST_TITLE_DIR="$HOME/.claude/skills/session-behavior/last-titles"
mkdir -p "$LAST_TITLE_DIR" 2>/dev/null
printf '%s' "$title" > "$LAST_TITLE_DIR/$session_id.txt"

# Debug log so we can confirm the hook fired and see what was set.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] update-title cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
# `|| true` guards the `set -e` above: a failed repaint must never fail a prompt.
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title" || true

# Output nothing to stdout (so we don't pollute Claude's context).
exit 0
