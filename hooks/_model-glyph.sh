#!/bin/bash
# Shared helper: build the tab title "<model> <status> <folder>".
# BUILD: 2026-07-09 22:31 v12 panel-top
#
# Why the model lives in the TITLE and not in the tab colour:
#   VS Code freezes a terminal's icon and colour at creation time -
#   `TerminalOptions.color` is consumed once by createTerminal() and the
#   `Terminal` object exposes no setter. Claude Code also persists the active
#   model nowhere on disk. So the tab title (rendered from the OSC sequence via
#   `terminal.integrated.tabs.title: "${sequence}"`) is the only surface that
#   can follow `/model` while a session is running.
#
#   Opus -> yellow   Fable -> blue    Haiku -> red    Sonnet -> green
#
# The model is read from the session transcript: the last non-sidechain
# assistant turn. Sidechains are subagents, which may run a different model -
# a Haiku subagent must not repaint the tab of an Opus session.
#
# A session that has not answered yet has no assistant turn, so the transcript
# cannot name the model. Fall back to the configured model in settings.json
# (project first, then user), otherwise a fresh tab stays blank until the first
# reply lands. The transcript still wins whenever it has an answer, so `/model`
# switches keep overriding the config.

CCM_MODEL_DIR="$HOME/.claude/skills/session-behavior/models"

# ccm_model_to_glyph <model-id>  ->  a coloured square, or nothing
ccm_model_to_glyph() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *fable*)  printf '🟦' ;;
    *haiku*)  printf '🟥' ;;
    *sonnet*) printf '🟩' ;;
    *opus*)   printf '🟨' ;;
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

# ccm_configured_model  ->  the "model" setting, nearest scope first
#
# Only a top-level `"model": "<id>"` matches: the leading quote keeps the
# pattern off sibling keys such as "advisorModel".
ccm_configured_model() {
  local f m
  for f in "$(pwd)/.claude/settings.local.json" \
           "$(pwd)/.claude/settings.json" \
           "$HOME/.claude/settings.json"; do
    [ -f "$f" ] || continue
    m=$(grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null \
      | head -1 \
      | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/')
    if [ -n "$m" ]; then printf '%s' "$m"; return 0; fi
  done
  return 1
}

# ccm_refresh_model_glyph <session_id> <transcript_path>
# Caches the glyph for the session's model: the transcript's last assistant turn
# when there is one, else the configured model. Silent no-op when neither names
# a model we have a square for - the cache stays empty and a later call retries.
ccm_refresh_model_glyph() {
  local sid="${1:-default}" tp="$2" model="" glyph
  if [ -n "$tp" ] && [ -f "$tp" ]; then
    model=$(tail -c 400000 "$tp" 2>/dev/null \
      | grep '"type":"assistant"' \
      | grep -v '"isSidechain":true' \
      | tail -1 \
      | grep -o '"model":"[^"]*"' | tail -1 \
      | sed 's/.*:"\(.*\)"$/\1/')
  fi
  [ -n "$model" ] || model=$(ccm_configured_model) || true
  [ -n "$model" ] || return 1

  # Never cache an empty glyph: an unknown model id must not look like a
  # resolved one, or the retry on the next hook would be skipped.
  glyph=$(ccm_model_to_glyph "$model")
  [ -n "$glyph" ] || return 1

  mkdir -p "$CCM_MODEL_DIR" 2>/dev/null
  printf '%s' "$glyph" > "$CCM_MODEL_DIR/$sid.txt"
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
