# Architecture

**Build:** `2026-07-09 v5 tty-first`

## Three problems, three fixes

1. **Readability** — horizontal tabs shrink. Fix: VS Code's terminal tab list
   placed on the **left** (`terminal.integrated.tabs.location: left`). A
   vertical list never shrinks, so 20 sessions stay readable.

2. **Status + model** — you can't tell which session is busy, or which model it
   runs. Fix: encode both in the **tab title**, driven by Claude Code **hooks**
   that already fire on session events.

3. **Which tab am I on?** — Fix: `terminal.tab.activeBorder` paints a bright
   border on the focused tab, and `terminal.integrated.tabs.showActiveTerminal:
   always` names it in a header above the list. Pure settings, no code.

## The title: `<model> <status> <folder>`

Example: `⬛ ⟳ claudeCodeManager` — an Opus session that is currently working.

| Event (hook)            | Status glyph | State        |
|-------------------------|--------------|--------------|
| `SessionStart`          | *(none)*     | fresh / idle |
| `UserPromptSubmit`      | `⟳`          | working      |
| `PostToolUse`           | `⟳`          | working      |
| `Stop`                  | `✓`          | your turn    |
| `Notification`          | `‼`          | needs you    |

| Model  | Square |
|--------|--------|
| Opus   | `⬛`   |
| Fable  | `🟦`   |
| Haiku  | `🟥`   |
| Sonnet | `🟩`   |

`PostToolUse` fires after every tool call, so it is **debounced (~2s)**;
`Stop`/`Notification` always apply so the final state never gets lost.

## Why the model is a square in the title, not the tab colour

The obvious design — tint the tab per model — is impossible:

- `TerminalOptions.color` and `iconPath` are consumed once by `createTerminal()`.
  The `Terminal` object exposes **no setter** for either, so neither can change
  while a session runs.
- `workbench.action.terminal.changeIcon` / `changeColor` **ignore any argument**
  and open the interactive picker. The PR that proposed argument support
  (microsoft/vscode#239973) was rejected.
- Claude Code persists the active model **nowhere on disk** — not in
  `~/.claude/settings.json`, not in `~/.claude.json`. At `createTerminal()` time
  the extension cannot know which model the session will use.
- You switch models mid-session with `/model`. A creation-time colour would be
  wrong from that moment on, permanently.

The title is the only surface that can follow `/model`. `_model-glyph.sh` reads
the model from the **last non-sidechain assistant turn** of the session
transcript (`transcript_path`, supplied to every hook on stdin) and caches its
square under `~/.claude/skills/session-behavior/models/<session_id>.txt`. The
sidechain filter matters: a Haiku subagent must not repaint an Opus session's tab.

A session that has not answered yet has no assistant turn, so the transcript
cannot name its model. `ccm_configured_model` then falls back to the top-level
`"model"` key of `.claude/settings.local.json`, `.claude/settings.json`, and
`~/.claude/settings.json`, in that order — nearest scope wins. The transcript
still takes precedence whenever it has an answer, so `/model` keeps overriding
the configured default.

The `Stop` hook re-reads the model on every turn, so a `/model` switch shows up
immediately. Other hooks read the cache.

Animation is likewise impossible. VS Code's `~spin` modifier only animates
`sync`, `loading`, `gear` and `notebook-state-executing` — and only where a
`ThemeIcon` is rendered, which for a terminal tab is the frozen creation-time
icon. A moving glyph in the *title* would need a ticker, i.e. a daemon, which
this project forbids (see below).

## How the title reaches the tab

Hook subprocesses do not share a normal TTY with the outer terminal, so setting
the title takes one of two paths (`_apply-title.sh` → `apply_tab_title`):

- **Inside VS Code** (`TERM_PROGRAM=vscode`): write the OSC title sequence
  straight to `/dev/tty`. Cheap — no extra process. This is the common path.
- **Elsewhere** (Windows Terminal): fall back to `set-tab-title.ps1`, which
  walks the process tree, `AttachConsole`s to the ancestor console, and
  `SetConsoleTitle`. Proven, but spawns PowerShell (~500ms) — hence the debounce.

Override with `CCM_TITLE_MODE=tty|ps|auto` (default `auto`).

## Why Claude Code's own title is disabled

Claude Code sets its own tab title (an auto conversation-topic summary) via OSC
on every render, which would overwrite ours. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`
in `~/.claude/settings.json` turns that off. **It is read at startup**, so it
only takes effect in a **new** Claude window.

## Resource & security profile (the hard constraint)

This environment must not cost significant resources or add attack surface:

- **No background process / daemon / poller.** Hooks run only on events, for
  milliseconds, then exit.
- **No network, no telemetry.** Everything is local file writes and a title escape.
- **One extension, no build step.** `ccm-hub` is plain JS side-loaded into
  `~/.vscode/extensions`; it only registers a URI handler and a command. It runs
  inside the VS Code process that is already open — it is not a new daemon.
- **No new privileges.** The VS Code integrated terminal is a *real* terminal —
  same shell, same user, same permissions as any standalone terminal. It is not
  a sandbox and does not reduce capability.
- **Lighter than before inside VS Code:** the common path is a single `printf`
  to `/dev/tty` instead of spawning PowerShell per event.

## Failure modes & fallbacks

- If `/dev/tty` is not writable, the code falls back to the PowerShell helper.
- If the PowerShell helper can't find the console, the title simply doesn't
  update — nothing else breaks, the session runs normally.
- `ccm.ps1` also sets the folder-name title itself at launch, so a tab is named
  even before the first hook fires.
- A fresh session paints `<square> ✓ <folder>` at `SessionStart`: idle-and-waiting
  is the same state `Stop` reports. Before `v4` the status was left blank and the
  square was omitted until the first assistant turn, so every tab in a reopened
  VS Code window looked unarmed until you typed into it.
- `ccm_refresh_model_glyph` still returns non-zero when *neither* the transcript
  nor the config names a model with a square (an unrecognised model id). It never
  caches an empty glyph, or the retry on the next hook would be skipped. Every
  caller guards it with `|| true` — `update-title.sh` runs under `set -e` and
  would otherwise abort before setting any title at all.
- `apply_tab_title` always returns 0, and `update-title.sh` calls it with
  `|| true`. A `-w /dev/tty` test is not sufficient: with no controlling terminal
  the device is writable yet `open(2)` fails with `ENXIO`. The title is cosmetic
  and must never fail a prompt.
