# ccm-hub — VS Code extension

**Build:** `2026-07-09 v1`

A tiny, buildless VS Code extension that opens a Claude Code session as a **new
integrated terminal in the current window** — so every session collects in one
"hub" window's vertical tab list.

## How it is triggered

It registers a URI handler. Anything (the Explorer right-click launcher, a
browser, another script) can fire:

```
vscode://ccm.hub/session?path=<percent-encoded-folder>&model=<optional>
```

The extension then:
1. `createTerminal({ name: <folder>, cwd: <folder> })`
2. `terminal.show()`
3. runs `claude --dangerously-skip-permissions`

The existing **session-behavior hooks** paint the status glyph on the tab.

No keystroke automation, no focus stealing, no timing — the VS Code Terminal API
does it directly and reliably.

## Also does

- **Panel on top** — on first activation, moves the terminal panel to the top
  (once; your later changes are respected).
- **Tab color by model** (optional) — if `model` is passed: fable=blue,
  haiku=red, sonnet=green, opus=neutral. (VS Code supports per-terminal *tab*
  color, not full background.)
- **Command palette** — `ccm: New Claude session in a terminal` (prompts for a path).

## Install (buildless — no npm, no compile)

```powershell
powershell -ExecutionPolicy Bypass -File ..\install-extension.ps1
```

Copies this folder to `%USERPROFILE%\.vscode\extensions\ccm.hub-0.0.1\`.
**Reload VS Code** (or open a new window) to activate.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File ..\uninstall-extension.ps1
```
