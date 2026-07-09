# ccm-hub — VS Code extension

**Build:** `2026-07-10 00:31 v13 project-picker`

A tiny, buildless VS Code extension that opens a Claude Code session as a **new
integrated terminal in the current window** — so every session collects in one
"hub" window's vertical tab list.

## How it is triggered

### 1. `Alt+O` — the project picker

A floating quick-pick listing every folder under `ccmHub.projectsRoot`
(default `E:\MAIN_CLAUDE`), **most recently used first**. Type to filter,
`Enter` to open; the picker closes itself and the session starts in a new
terminal. Picking a folder that is already running just focuses its tab
instead of stacking a second Claude on it.

Recency comes from two sources, merged with `max()`:

| Source | Covers | Gap it fills |
|---|---|---|
| `globalState` MRU | folders opened *via the picker* | exact, but empty on a fresh install |
| `~/.claude/projects/<encoded-cwd>/` mtime | folders where Claude *actually ran* | works on the very first `Alt+O`, and catches sessions started by `ccm.ps1`, the Explorer menu, or a bare `claude` |

Claude encodes a project's cwd into a directory name by replacing every
non-alphanumeric character with `-`. That mapping is **lossy** (`הקלטה לקלוד`
becomes a run of dashes), so it is only ever used **forwards**, from a real
folder found on disk. Never try to recover the folder list from `~/.claude`.

Also note: on NTFS a directory's mtime moves when a file is *created* inside it,
but **not** when an existing file is appended to — and a long Claude session is
one long append to a single `.jsonl`. So `projects.js` takes the newest mtime of
the directory **and** its transcripts. Using the directory alone made a session
that was live *at that moment* report `8h ago`.

### 2. A URI

Anything (the Explorer right-click launcher, a browser, another script) can fire:

```
vscode://ccm.hub/session?path=<percent-encoded-folder>
```

Either way the extension does:
1. `createTerminal({ cwd })` — **never** with `name`, see below
2. `terminal.show()`
3. writes an OSC title sequence, then runs `ccmHub.claudeCommand`

The existing **session-behavior hooks** then own the tab title (status + model).

No keystroke automation, no focus stealing, no timing — the VS Code Terminal API
does it directly and reliably.

## Two traps this file exists to remember

**Never pass `name` to `createTerminal`.** It pins VS Code's `titleSource` to
`Api`, which beats `${sequence}` *permanently* — the tab freezes on that name and
every OSC title the hooks write is silently ignored.

**`Alt+O` must be in `terminal.integrated.commandsToSkipShell`.** A keypress in a
focused terminal is forwarded to the shell unless its command id is on that list,
and a custom command is never on VS Code's 159-entry default. Without it, Alt+O
would be eaten by PowerShell and the picker would simply never appear. The
extension appends its id on activation, idempotently — verified in the 1.128
bundle that the user's array is *merged into* the defaults
(`let t = new Set(defaults); … t.add(r)`; a `-` prefix removes), so this destroys
nothing. It is done from code rather than from the installer's settings merge,
because that merge overwrites a key wholesale and would drop ids the user added.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `ccmHub.projectsRoot` | `E:\MAIN_CLAUDE` | folders listed by `Alt+O` |
| `ccmHub.claudeCommand` | `claude --dangerously-skip-permissions` | what runs in the new terminal |

## Commands

- `ccm: Open project (recent first)` — the `Alt+O` picker
- `ccm: New Claude session in a terminal` — prompts for a path

## Also does

- **Panel on top** — on first activation *in each workspace*, moves the terminal
  panel to the top (once; your later changes are respected). The flag lives in
  `workspaceState` because VS Code stores `workbench.panel.position` per
  workspace.

## Install (buildless — no npm, no compile)

```powershell
powershell -ExecutionPolicy Bypass -File ..\install-extension.ps1
```

Copies this folder to `%USERPROFILE%\.vscode\extensions\ccm.hub-<version>\`.
**Reload VS Code** (or open a new window) to activate.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File ..\uninstall-extension.ps1
```
