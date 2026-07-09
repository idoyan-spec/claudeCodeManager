# Architecture

**Build:** `2026-07-10 00:31 v13 project-picker`

## Three problems, three fixes

1. **Readability** — horizontal tabs shrink. Fix: VS Code's terminal tab list
   placed on the **left** (`terminal.integrated.tabs.location: left`). A
   vertical list never shrinks, so 20 sessions stay readable.

2. **Status + model** — you can't tell which session is busy, or which model it
   runs. Fix: encode both in the **tab title**, driven by Claude Code **hooks**
   that already fire on session events.

3. **Which tab am I on?** — Fix: an amber `terminal.tab.activeBorder` plus a
   filled row background. `terminal.tab.activeBorder` is the **only**
   terminal-tab-specific colour VS Code defines, and it is a thin line; the row
   fill has to come from the global `list.*` selection colours, which also tint
   Explorer/Search. Accepted trade. The load-bearing key is
   `list.inactiveSelectionBackground` — while you type in the terminal the tab
   list is unfocused, so its selected row is drawn as an *inactive* selection.

## The title: `<model> <status> <folder>`

Example: `🟨 ⟳ claudeCodeManager` — an Opus session that is currently working.

| Event (hook)            | Status glyph | State        |
|-------------------------|--------------|--------------|
| `SessionStart`          | `✓`          | fresh / idle |
| `UserPromptSubmit`      | `⟳`          | working      |
| `PostToolUse`           | `⟳`          | working      |
| `Stop`                  | `✓`          | your turn    |
| `Notification` (idle)   | `✓`          | your turn    |
| `Notification` (other)  | `‼`          | needs you    |

| Model  | Square |
|--------|--------|
| Opus   | `🟨`   |
| Fable  | `🟦`   |
| Haiku  | `🟥`   |
| Sonnet | `🟩`   |

`PostToolUse` fires after every tool call, so it is **debounced (~2s)**;
`Stop`/`Notification` always apply so the final state never gets lost.

**Not every Notification is an alarm.** Claude Code raises `Notification` both
for a permission/decision request *and* for "idle ~60s waiting for input". Painting
both as `‼` meant a finished tab decayed from `✓` to `‼` a minute later, and the
glyph stopped carrying information — `set-title.log` showed 145 `done` events
against 143 `attention` events.

`restore-title.sh` demotes the idle case to `✓`. It checks the structured
`notification_type == idle_prompt` first, then falls back to matching the
`message` text, because `notification_type` is reported missing on permission
prompts (anthropics/claude-code#11964) and the message strings are undocumented.
Anything unrecognised **stays** `‼`: a spurious alarm is a nuisance, a swallowed
permission request stalls the session forever. The raw payload of every
Notification is appended to `notifications.log` so the matching can be re-derived
from evidence rather than re-guessed.

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

`_apply-title.sh` → `apply_tab_title` tries two paths, in order:

1. Write the OSC title sequence straight to `/dev/tty`.
2. Fall back to `set-tab-title.ps1`, which walks the process tree,
   `AttachConsole`s to the ancestor console, and `SetConsoleTitle`s. ConPTY
   forwards that title to VS Code, which renders it as `${sequence}`.

Override with `CCM_TITLE_MODE=tty|ps|auto` (default `auto`).

**Measured, not assumed:** path 1 **never fires in practice**. Claude Code spawns
hooks with piped stdio and no controlling terminal, so opening `/dev/tty` fails
with `ENXIO` — in VS Code and in Windows Terminal alike. Every real hook logs
`apply via=ps`. Until v5 the tty branch was additionally gated on
`TERM_PROGRAM=vscode` (which *is* set inside VS Code), so the gate looked like
the reason VS Code worked; it wasn't. Path 2 does all the work everywhere. The
attempt at path 1 is kept because it is one cheap `printf` and it is the right
answer on any host that does give a hook a tty.

`apply_tab_title` logs `via=tty|ps|failed` and `TERM_PROGRAM` to
`set-title.log` on every call, so this never has to be re-derived by guesswork.

## Why the extension must not name its terminal

`ccm-hub` used to call `createTerminal({ name, cwd, iconPath })`. Passing `name`
sets VS Code's `titleSource` to `Api`, and an **Api title outranks
`${sequence}` permanently**: the tab freezes on the name given at creation and
every OSC title the hooks write afterwards is discarded.

The symptom was maximally confusing, because everything *else* worked. The
sparkle icon appeared, the active-tab border appeared, and `GetConsoleTitle` on
the live shell returned exactly `⬛ ✓ קליקיט` — yet the tab read `קליקיט`.
(Opus was `⬛` back then; it became `🟨` in v7. The quotes above are verbatim.)
Meanwhile a plain `Ctrl+Shift+5` terminal in the same window, created with no
Api name, rendered `🟥 ✓ הקלטה לקלוד` correctly. That contrast is the proof.

So the extension passes **no** `name`. It emits one OSC sequence itself before
launching Claude, which titles the tab with the folder immediately; from the
first `SessionStart` hook onward the hooks own the title.

## Focus: landing the caret on the prompt line

Selecting a session should leave you ready to type. Focus is **singular** — it is
either in the tab list or in a terminal — so "arrow through the list *and* be on
the prompt line" is self-contradictory past the first press. Three situations:

| You are… | Key | What happens |
|----------|-----|--------------|
| clicking a tab | single click | `terminal.integrated.tabs.focusMode: singleClick` |
| in the tab list | `↑` / `↓` | move, enter that terminal, leave the list |
| in a terminal | `Ctrl+↑`/`Ctrl+↓` **or** `Alt+↑`/`Alt+↓` | switch session, never leave the prompt line |

Only the mouse case is a setting. Verified in the 1.128 bundle: `focusMode` is
read by exactly two handlers — `onMouseClick` (acts on `singleClick`) and
`onMouseDblClick` (acts on `doubleClick`). **No keyboard handler reads it**, so a
keyboard fix through that setting is impossible.

The list case uses `runCommands` to chain
`list.focusDown` → `list.select` → `workbench.action.terminal.focus`.
`list.select` fires the tab list's `onDidOpen`, which calls `setActiveInstance()`
and focuses the instance; the trailing `terminal.focus` is belt-and-braces
because `onDidOpen` honours `preserveFocus`. Plain `list.focusDown` alone only
moves the highlight — that list's `onDidChangeFocus` updates a context key and
nothing else.

`Ctrl+↑`/`Ctrl+↓` override VS Code's default `scrollToPreviousCommand` /
`scrollToNextCommand` (same keys, `when: terminalFocus`). Those navigate between
past command outputs via shell integration, which is inert inside Claude Code's
fullscreen TUI, so the trade costs nothing. `Alt+↑/↓` were free in the terminal.

Since `v11` **both** modifiers are bound to the same two commands. Shipping only
`Ctrl` was a mistake: the design conversation had mentioned `Alt` as the fallback,
so that is the key the user reached for, found dead, and reported as a broken
feature. Two keys onto one command costs two lines and removes the guess.
`Ctrl+PageUp`/`Ctrl+PageDown` also still work — stock bindings, same two commands
(default `primary: 2060` = `2048` CtrlCmd | `12` PageDown).

**A keypress in a terminal only reaches VS Code if the command it resolves to is
listed in the default `terminal.integrated.commandsToSkipShell`** — otherwise the
bytes go to the shell. Verified against the 1.128 bundle: that list holds 159
entries and includes `focusNext` and `focusPrevious`, which is why the modifier
arrows work at all. It also includes `runCommands`, but the two `runCommands`
bindings are gated on `terminalTabsFocus`, where no shell is listening anyway.

Settings and keybindings are both watched live: a focus change needs no reload.

## Flashing the tab that needs you

VS Code turns a **BEL byte** into a timed, per-tab status icon:

```js
onBell(() => { if (enableVisualBell) statusList.add({id:'bell', severity:Warning, icon:bell}, bellDuration) })
```

So the tab of the session that wants you flashes, and only that tab.
`terminal.integrated.enableVisualBell: true`, `bellDuration: 3000`, and
`list.warningForeground` paints the icon red.

**A hook cannot ring it.** Hooks get piped stdio and no controlling terminal, so
they cannot put a byte on the pty — the same constraint that makes the title go
through `SetConsoleTitle`. Attaching to the console from outside and calling
`WriteConsoleW("\a")` does return success, but conhost treats BEL as a beep
rather than screen content and does not forward it to the pty. Dead end.

**Claude Code can ring it**, because its stdout *is* the pty. Setting
`preferredNotifChannel: "terminal_bell"` in `~/.claude/settings.json` makes it
emit BEL on `permission_prompt` and on `idle_prompt`. Read at **startup**, so it
only applies to sessions opened afterwards.

That pairing is deliberate: the glyph still separates the two states (`‼` vs `✓`),
while the flash fires for both — Claude wants something, or Claude has been
waiting for you a while. It does not fire the instant `Stop` lands, which is the
right behaviour: no flash while you are already looking at the session.

## Which tab is active, really

`.terminal-tabs-entry.is-active:before { width: 1px; background-color: var(--vscode-terminal-tab-activeBorder) }`

That 1px bar is the **only** marker bound to the active terminal, and its width
is hardcoded in the stylesheet. The blue row fill everyone reaches for comes from
`.monaco-list-row.selected`, i.e. the list **selection** — a different concept.
VS Code clears that selection when you click the empty area under the tabs, and
restores it only when the active instance next changes. So the fill disappears
while the terminal is still active.

Hence: the bar is bright red (`#ff1a1a`) because it is what always survives; the
blue fill is a bonus that is present most of the time. Widening the bar needs CSS
injection via a third-party loader that patches the workbench and trips VS Code's
"installation corrupt" warning — rejected, it violates the light+safe constraint.

## Putting the terminal panel on top

`workbench.action.positionPanelTop` exists and works, but the position it sets is
persisted **per workspace**, as the numeric `workbench.panel.position` in that
workspace's `state.vscdb` (`0=left 1=right 2=bottom 3=top`, per the bundle's
`positionToString`).

`ccm-hub` used to run the command once and record that in **`globalState`** — a
machine-wide flag guarding a per-workspace effect. The first folder opened after
install got its panel moved; the flag flipped; every other folder kept its bottom
panel forever, and nothing indicated why. Measured before the fix: 4 of 5 recent
workspaces still held `workbench.panel.position = 2`.

Two changes, covering the two populations:

- **Workspaces with no stored position** — `workbench.panel.defaultLocation: "top"`
  in settings.json. No code involved.
- **Workspaces that already have one** — the extension still runs the command, but
  the guard now lives in **`workspaceState`**, so each workspace converts exactly
  once and a user who drags the panel back is never overruled.

The extension activates on `onStartupFinished` (as well as `onUri`), which is what
makes "applies on reload" true at all.

## Making the install portable

Everything above is worthless on a second machine if the installer doesn't
reproduce it. Until `v12` `install.ps1` copied the hook scripts to
`~/.claude/skills/session-behavior/scripts/` and **never registered them**, so
nothing ever called them; it *warned* about `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`
instead of setting it; and its one JSON write used `Set-Content -Encoding UTF8`,
which emits a **BOM** in Windows PowerShell. A fresh machine would have shown bare
tabs and one yellow line that didn't name the real problem.

`install.ps1` now writes, idempotently and after a backup: `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE`,
`preferredNotifChannel`, and all six hook entries (five title hooks + the alert
sound). Each is matched on a signature substring, so re-running adds nothing and a
hook the user re-pointed elsewhere is left alone. All JSON goes through
`Write-JsonObject` / `Write-JsonFile`, which use `UTF8Encoding($false)`.

The alert-sound hook resolves the Windows directory with
`[Environment]::GetFolderPath('Windows')` rather than a literal `C:\Windows`, and
contains **no `$`**: hook commands are handed to a shell that expands `$` — that is
precisely how `$HOME` in the title hooks resolves — so `$env:SystemRoot` would be
eaten before `powershell` ever saw it.

Verified by running the installer three times against a sandboxed fake machine
(`USERPROFILE`/`APPDATA` redirected to a temp tree): run 1 registers everything,
runs 2 and 3 report "already registered" and write nothing; the user's real
`settings.json` stayed byte-identical throughout, and the emitted sound command
executes through `bash -c` with exit 0.

## The `Alt+O` project picker

A `showQuickPick` over the immediate subdirectories of `ccmHub.projectsRoot`,
ordered most-recently-used first. Choosing one opens a terminal there, runs
`ccmHub.claudeCommand`, and the picker dismisses itself.

### Where "most recently used" comes from

Neither available source is sufficient alone, so `projects.js` takes `max()` of both:

| Source | Knows about | Blind to |
|---|---|---|
| the extension's `globalState` MRU | folders opened through the picker | everything on a fresh install; sessions started by `ccm.ps1`, the Explorer menu, or a bare `claude` |
| mtime of `~/.claude/projects/<encoded-cwd>/` | every folder Claude has actually run in | nothing — but it only moves when Claude runs |

The second source is what makes the *very first* `Alt+O` already correct.

### The encoding is one-way

Claude derives a project's history-directory name from its absolute cwd by
replacing every non-alphanumeric character with `-`. Measured on this machine:
15 of 30 folders under `E:\MAIN_CLAUDE` matched exactly (the other 15 are folders
Claude has never run in), with **zero collisions**. Because `\` and `/` both
collapse to `-`, the separator style of the path we build does not matter.

But the mapping is **lossy**: `הקלטה לקלוד` encodes to a bare run of dashes and
cannot be decoded back. So it is only ever applied **forwards**, starting from a
real folder found on disk. Do not try to reconstruct the project list by reading
`~/.claude/projects` — two same-length non-ASCII names would be indistinguishable.
(A transcript's `cwd` field does hold the true path, if a reverse lookup is ever
genuinely needed.)

### A directory's mtime lies about live sessions

On NTFS a directory's mtime moves when a file is *created* or removed inside it,
but **not** when an existing file is appended to — and a long Claude session is
one long append to a single `.jsonl`. Ranking by directory mtime alone reported
`8h ago` for a folder whose session was live *at that moment*; its transcript had
been written 46 seconds earlier while the directory still read 8 hours old.
`historyStamp()` therefore takes the newest mtime of the directory **and** every
`.jsonl` in it. Cost measured at ~7 ms for 30 projects — cheap enough to do
synchronously each time the picker opens, which keeps it always-fresh.

### The keybinding would otherwise be swallowed

A keypress while a terminal has focus is forwarded to the shell unless its command
id appears in `terminal.integrated.commandsToSkipShell`. A custom command is never
in VS Code's 159-entry default list, so `Alt+O` pressed inside a Claude session —
the only place it matters — would go to PowerShell and the picker would never open.

From the 1.128 bundle:

```js
let t = new Set(nit);                       // nit = the 159 defaults
let i = e.commandsToSkipShell ?? [];
for (…) { if (r[0] === "-") t.delete(r.slice(1)); else t.add(r); }
```

So the user's array is **merged into** the defaults (a `-` prefix removes an
entry) and appending one id destroys nothing. The extension appends its own id in
`activate()`, guarded by an `includes()` check. This is deliberately *not* done
through the installer's settings merge: that merge overwrites a key wholesale and
would silently drop any ids the user had added.

`Alt+O` itself was chosen by grepping the bundle for keybinding codes
(`Alt = 512`, `KeyO = 45` → `primary: 557`): **0** hits, versus 3 for `Alt+P`.
It ships in the extension's `contributes.keybindings`, so it travels with the
extension and needs no `keybindings.json` edit.

### Testability

`projects.js` deliberately does not `require('vscode')`. The ranking — the only
part with real logic — is plain Node and is exercised directly against the live
`~/.claude/projects` tree. `extension.js` is driven in tests through a stubbed
`vscode` module, which is how the "never pass `name` to `createTerminal`"
invariant below is guarded against regression.

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
- **One PowerShell per title change** (~500ms), which is why `PostToolUse` is
  debounced. The `/dev/tty` shortcut would avoid it, but it does not work here
  (see above) — the cost is real and accepted, not hypothetical.

## Failure modes & fallbacks

- If `/dev/tty` cannot be opened — which is the normal case — the code falls back
  to the PowerShell helper.
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
