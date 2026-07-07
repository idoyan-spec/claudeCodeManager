# Architecture

**Build:** `2026-07-07 v1 vscode-hub`

## Two independent problems, two fixes

1. **Readability** — horizontal tabs shrink. Fix: VS Code's terminal tab list
   placed on the **right** (`terminal.integrated.tabs.location: right`). A
   vertical list never shrinks, so 20 sessions stay readable.

2. **Status** — you can't tell which session is busy. Fix: encode the state in
   the **tab title** as a leading glyph, driven by Claude Code **hooks** that
   already fire on session events.

## The status pipeline

Claude Code fires hooks on lifecycle events. We reuse the existing
`session-behavior` hooks and change only the title string they emit:

| Event (hook)            | Title set        | State        |
|-------------------------|------------------|--------------|
| `SessionStart`          | `<folder>`       | fresh / idle |
| `UserPromptSubmit`      | `⚙ <folder>`     | working      |
| `PostToolUse`           | `⚙ <folder>`     | working      |
| `Stop`                  | `✅ <folder>`    | your turn    |
| `Notification`          | `🔔 <folder>`    | needs you    |

`PostToolUse` fires after every tool call, so it is **debounced (~2s)**;
`Stop`/`Notification` always apply so the final state never gets lost.

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
- **No new software.** VS Code is already installed; no extension is required.
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
