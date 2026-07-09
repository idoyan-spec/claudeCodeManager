#!/bin/bash
# Shared helper: build the tab title "<model> <status> <folder>".
# BUILD: 2026-07-09 v3 status-icons
#
# Why the model lives in the TITLE and not in the tab colour:
#   VS Code freezes a terminal's icon and colour at creation time -
#   `TerminalOptions.color` is consumed once by createTerminal() and the
#   `Terminal` object exposes no setter. Claude Code also persists the active
#   model nowhere on disk. So the tab title (rendered from the OSC sequence via
#   `terminal.integrated.tabs.title: "${sequence}"`) is the only surface that
#   can follow `/model` while a session is running.
#
#   Opus -> black    Fable -> blue    Haiku -> red    Sonnet -> green
#
# The model is read from the session transcript: the last non-sidechain
# assistant turn. Sidechains are subagents, which may run a different model -
# a Haiku subagent must not repaint the tab of an Opus session.

CCM_MODEL_DIR="$HOME/.claude/skills/session-behavior/models"

# ccm_model_to_glyph <model-id>  ->  a coloured square, or nothing
ccm_model_to_glyph() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *fable*)  printf '🟦' ;;
    *haiku*)  printf '🟥' ;;
    *sonnet*) printf '🟩' ;;
    *opus*)   printf '⬛' ;;
    *)        printf ''   ;;
  esac
}

# ccm_json_str <json> <key>  ->  the string value of a top-level key
ccm_json_str() {
  printf '%s' "$1" \
    | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -1 \
    | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'
}

# ccm_transcript_path <json>  ->  a path Git Bash can stat (backslashes folded)
ccm_transcript_path() {
  ccm_json_str "$1" transcript_path | sed 's|\\\\|/|g; s|\\|/|g'
}

# ccm_refresh_model_glyph <session_id> <transcript_path>
# Re-reads the model from the transcript and caches its glyph. Silent no-op if
# the transcript is missing or holds no assistant turn yet.
ccm_refresh_model_glyph() {
  local sid="${1:-default}" tp="$2" model
  [ -n "$tp" ] && [ -f "$tp" ] || return 1
  model=$(tail -c 400000 "$tp" 2>/dev/null \
    | grep '"type":"assistant"' \
    | grep -v '"isSidechain":true' \
    | tail -1 \
    | grep -o '"model":"[^"]*"' | tail -1 \
    | sed 's/.*:"\(.*\)"$/\1/')
  [ -n "$model" ] || return 1
  mkdir -p "$CCM_MODEL_DIR" 2>/dev/null
  printf '%s' "$(ccm_model_to_glyph "$model")" > "$CCM_MODEL_DIR/$sid.txt"
}

# ccm_model_glyph <session_id>  ->  the cached glyph (or nothing)
ccm_model_glyph() {
  local f="$CCM_MODEL_DIR/${1:-default}.txt"
  [ -f "$f" ] && cat "$f"
}

# ccm_title <status_glyph> <session_id> <folder>
# Prints "<model> <status> <folder>", dropping any part that is empty.
ccm_title() {
  local status="$1" sid="$2" folder="$3" mg
  mg=$(ccm_model_glyph "$sid")
  if [ -n "$mg" ] && [ -n "$status" ]; then
    printf '%s %s %s' "$mg" "$status" "$folder"
  elif [ -n "$mg" ]; then
    printf '%s %s' "$mg" "$folder"
  elif [ -n "$status" ]; then
    printf '%s %s' "$status" "$folder"
  else
    printf '%s' "$folder"
  fi
}
