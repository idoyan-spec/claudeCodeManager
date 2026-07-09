#!/bin/bash
# Re-apply the tab title after Claude Code renders.
# BUILD: 2026-07-10 00:31 v13 project-picker
#
# Title format:  "<model square> <status> <folder>"   e.g.  "🟨 ⟳ claudeCodeManager"
#
# Called with a STATE argument that maps to a status glyph:
#   working    -> "⟳"   Claude is busy (PostToolUse)
#   done       -> "✓"   Claude finished, your turn (Stop)
#   attention  -> "‼"   Claude needs you now (Notification / permission)
#
# Legacy: "--force" is accepted and treated as "done".
#
# "working" is debounced (~2s) because PostToolUse fires after every tool and
# the PowerShell fallback costs ~500ms. "done"/"attention" always apply so the
# final state is never missed.
#
# THE IDLE NOTIFICATION IS NOT AN ALARM. Claude Code fires `Notification` for two
# unrelated things: a real permission/decision request, and "you have been idle
# for ~60s". Treating both as "‼" meant every finished tab silently decayed from
# ✓ to ‼ one minute later, and the glyph stopped meaning anything. Measured in
# set-title.log: `done` and `attention` counts were near-identical (145 vs 143).
#
# Distinguishing them is awkward. `notification_type` is the structured field,
# but it is reported missing on permission prompts (anthropics/claude-code#11964),
# and the `message` strings are not in the docs. So: check BOTH, and let anything
# unrecognised keep shouting. A spurious ‼ is a nuisance; a swallowed permission
# request stalls the session forever. Fail loud.
#
# The raw payload of every Notification is appended to notifications.log, so this
# can be re-derived from evidence when Claude Code changes the shape.

state="${1:-done}"
force=1
case "$state" in
  working) force=0 ;;
esac

# Hooks receive their event JSON on stdin. Read it only when stdin is a pipe,
# so the script stays runnable by hand from a terminal.
INPUT=""
if [ ! -t 0 ]; then INPUT=$(cat); fi

source "$HOME/.claude/skills/session-behavior/scripts/_model-glyph.sh"

# Demote an idle notification to "your turn" before it becomes a glyph.
if [ "$state" = "attention" ]; then
  NOTIF_LOG="$HOME/.claude/skills/session-behavior/notifications.log"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$INPUT" >> "$NOTIF_LOG" 2>/dev/null

  ntype=$(ccm_json_str "$INPUT" notification_type)
  nmsg=$(ccm_json_str "$INPUT" message)
  case "$ntype" in
    idle_prompt) state="done" ;;
    "")
      # No structured field: fall back to the message. Only the idle text is
      # demoted; an unknown message stays an alarm.
      case "$nmsg" in
        *[Ww]aiting*) state="done" ;;
      esac
      ;;
  esac
fi

case "$state" in
  working)   glyph="⟳" ;;
  attention) glyph="‼" ;;
  *)         glyph="✓" ;;
esac

session_id=$(ccm_json_str "$INPUT" session_id)
[ -n "$session_id" ] || session_id="${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
[ -n "$session_id" ] || session_id="default"

LAST_TITLE_DIR="$HOME/.claude/skills/session-behavior/last-titles"

if [ "$force" -ne 1 ]; then
  STAMP_FILE="$LAST_TITLE_DIR/$session_id.stamp"
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

# Re-read the model on Stop (the assistant turn that just landed is authoritative,
# so a /model switch shows up immediately). Otherwise only fill an empty cache.
transcript=$(ccm_transcript_path "$INPUT")
if [ "$state" = "done" ] || [ -z "$(ccm_model_glyph "$session_id")" ]; then
  ccm_refresh_model_glyph "$session_id" "$transcript" || true
fi

dirname=$(basename "$(pwd)")
title=$(ccm_title "$glyph" "$session_id" "$dirname")

# Debug log.
LOG="$HOME/.claude/skills/session-behavior/set-title.log"
printf '[%s] restore-title state=%s cwd=%s session=%s title=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$state" "$(pwd)" "$session_id" "$title" >> "$LOG" 2>/dev/null

# Apply the title (cheap OSC in VS Code, PowerShell helper elsewhere).
source "$HOME/.claude/skills/session-behavior/scripts/_apply-title.sh"
apply_tab_title "$title"

exit 0
