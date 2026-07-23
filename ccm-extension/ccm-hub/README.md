# ccm-hub — VS Code extension

**Build:** see `build.js` — the one constant every surface reads
(currently `2026-07-23 23:12 v23 file-browser`)

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

### 2. `Alt+Q` — close a terminal without losing it

Asks three questions before anything is destroyed:

| Button | What happens |
|---|---|
| **גבה וסגור** | runs `/session-backup` **in that session**, waits for the hooks to report it finished, and only then closes the tab |
| **סגור** | closes it now |
| **השאר פתוח** | nothing. It is the dialog's close-affordance, so `Esc` and the `X` mean this too |

The dialog **names the folder** it is about to close. `Alt+Q` and the two terminal
context menus act on the *active* terminal, so if a right-click on a background
tab ever failed to activate it, the user reads the wrong name and presses
*keep* — instead of silently losing the wrong session.

Waiting is done by polling `Terminal.name`. VS Code forwards a terminal's
resolved title to the extension host — `onAnyInstanceTitleChange(i =>
$acceptTerminalTitleChange(i.instanceId, i.title))` — so `term.name` is a live
read of the glyph the ccm hooks last wrote: `⟳` working, `✓` idle, `‼` needs you.

The poll waits for `⟳` **first**. The tab still carries a stale `✓` from before
the backup was submitted, so waiting for `✓` would close the terminal instantly,
having backed up nothing. Then it waits for `✓` to hold still for three polls,
because the `Stop` hook can fire between tool calls.

**The terminal is closed on exactly one outcome: the backup finished.** Timeout,
cancellation, Claude asking a question, an unresponsive session — every one of
those leaves the terminal open. A feature whose entire purpose is "do not lose a
terminal by accident" must never lose a terminal by accident.

### 3. The trash icon — VS Code's own guard

**There is no cancellable "terminal is about to close" event.** The extension API
has `onDidCloseTerminal` and nothing else; `onWillCloseTerminal` does not exist
anywhere in the 1.128 extension host. An extension therefore *cannot* put its own
dialog in front of the trash icon. Don't go looking; it isn't there.

What does exist is `terminal.integrated.confirmOnKill`. Every built-in kill path —
trash icon, middle-click on the tab, `Kill Terminal`, `Kill All` — funnels through
`safeDisposeTerminal`, which is gated on it:

```js
async safeDisposeTerminal(e) {
  if (!(e.target !== 2 && e.hasChildProcesses &&
        (config.confirmOnKill === "panel" || config.confirmOnKill === "always") &&
        await this._showTerminalCloseConfirmation(true)))
    return new Promise(t => { once(e.onExit)(() => t()), e.dispose(3) })
}
```

VS Code's default is `"editor"`, which confirms only for terminals opened in the
editor area — a **panel** terminal, which is every terminal ccm opens, dies to one
click with no warning. So the extension sets it to `"always"` on activation, and
only if the user has no value of their own. Its dialog offers Terminate/Cancel,
which buys *close vs keep* but not *backup* — that is what `Alt+Q` is for.

Note the `hasChildProcesses` term: a terminal sitting idle at a bare prompt has
none, and still closes without a word. So `onDidCloseTerminal` adds an undo — a
session killed with `TerminalExitReason.User` (3) is offered back with
`claude --continue`, which reopens the conversation from the transcript Claude
persisted under `~/.claude/projects/`. `Process` (2), `Shutdown` (1) and
`Extension` (4) exits are silent: those are claude quitting on its own, VS Code
closing, and our own `dispose()`.

### 4. `Alt+E` — the floating file browser

A two-pane browser — folder tree on the left, contents on the right — drawn as a
centred card over a dimmed backdrop, driven entirely from the keyboard, and
disposed the moment it stops being the active tab. Code lives in `browser/`.

**Why a webview panel and not a real floating window.** The extension API exposes
no floating window. `createWebviewPanel` is the only surface an extension can
paint freely, and it lands in the editor area as a tab; the floating *behaviour*
comes from `preserveFocus: false` + a backdrop + `onDidChangeViewState → dispose`,
the same recipe the explain card already uses. VS Code 1.85+ *can* move an editor
into an OS auxiliary window (`workbench.action.moveEditorToNewWindow`), but such a
window has no "close when you touch something else" semantics — it would break the
requirement rather than serve it.

**Why the dialogs are drawn inside the webview.** `showInputBox` /
`showWarningMessage` take focus, and this panel closes on blur — a rename through
a native dialog would kill the browser mid-rename. Rename, create, delete-confirm
and the missing-agent prompt are all painted in `webview.js`.

**The agent submenu.** `browser/agents.js` probes PATH itself (`existsSync` over
`PATH` × `PATHEXT`, ~1-3ms) rather than spawning `where.exe` per agent (~50ms × 8,
a visible stutter on a menu that must appear instantly). A miss is never treated
as "cannot run": a process cannot see PATH edits made after it started, so a
missing agent is shown greyed with **install** *and* **run anyway**. Claude is
routed back through `openSession` in `extension.js` so the close guard, the
restore offer and the already-running check keep applying; every other agent gets
a named terminal, because no hook writes an OSC title into one and an unnamed tab
would just read `powershell`.

**Running a file.** `fsops.runnerFor` maps extension → argv, and `commandLine`
quotes every element for PowerShell (`& 'powershell' '-File' 'C:\it''s\x.ps1'`).
An unknown extension falls through to `openExternal`, i.e. the OS association —
what a double-click in Explorer does. `Enter` deliberately *opens* rather than
runs; ▶ / `F5` / `Ctrl+Enter` run, and `ccmHub.browser.enterRuns` flips `Enter`.

**One trap, already paid for.** `webview.html` carries `__CSS__` and `__JS__`
placeholders that `index.js` swaps for the real files. `String.replace` hits the
**first** occurrence only, so mentioning either token again — even in a comment —
silently eats the substitution and ships a page with no script. A test asserts the
composed HTML contains neither token.

### 5. A URI

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

**`Alt+O`, `Alt+Q` and `Alt+E` must be in `terminal.integrated.commandsToSkipShell`.** A
keypress in a focused terminal is forwarded to the shell unless its command id is
on that list, and a custom command is never on VS Code's 159-entry default.
Without it, Alt+O would be eaten by PowerShell and the picker would simply never
appear. The extension appends its ids on activation, idempotently — verified in
the 1.128 bundle that the user's array is *merged into* the defaults
(`let t = new Set(defaults); … t.add(r)`; a `-` prefix removes), so this destroys
nothing. It is done from code rather than from the installer's settings merge,
because that merge overwrites a key wholesale and would drop ids the user added.

Both keys were picked by grepping the bundle for their keycode: `Alt+O` is
`primary:557` (0 hits) and `Alt+Q` is `primary:559` (0 hits). `Alt+W` (`565`)
looked free but is `toggleFindWholeWord`, scoped to `when: findVisible` — which is
true exactly when a terminal has focus.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `ccmHub.projectsRoot` | `E:\MAIN_CLAUDE` | folders listed by `Alt+O` |
| `ccmHub.claudeCommand` | `claude --dangerously-skip-permissions` | what runs in the new terminal |
| `ccmHub.guardTerminalClose` | `true` | sets `confirmOnKill` to `always` (only if you have no value of your own) and offers to restore a killed session. `Alt+Q` asks regardless |
| `ccmHub.ensureAutoSave` | `true` | fills `files.autoSave` with `afterDelay` when you have no value of your own |
| `ccmHub.browser.enterRuns` | `false` | make `Enter` **run** a runnable file in the `Alt+E` browser instead of opening it |
| `ccmHub.browser.showHidden` | `false` | start the browser with dot-files visible (`Ctrl+H` toggles per session) |
| `ccmHub.browser.agents` | `[]` | extra agents for the browser's AI submenu, or overrides of the built-ins by `id` |

## Commands

- `ccm: Open project (recent first)` — the `Alt+O` picker
- `ccm: Close terminal (backup / close / keep)` — the `Alt+Q` guard, also on both terminal context menus
- `ccm: Open the floating file browser` — the `Alt+E` browser
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
