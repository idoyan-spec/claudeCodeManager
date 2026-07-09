# Architecture

**Build:** `2026-07-09 21:10 v10 tab-bell`

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
| in a terminal | `Ctrl+↑` / `Ctrl+↓` | switch session, never leave the prompt line |

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
fullscreen TUI, so the trade costs nothing. `Alt+↑/↓` were free and would have
avoided the override; `Ctrl` was chosen because it is easier to reach.
`Ctrl+PageUp`/`Ctrl+PageDown` still work — they are the stock bindings for the
same two commands.

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
