# Claude Code Manager (ccm)

**Build:** `2026-07-17 14:05 v20 window-confirm-close`

A lightweight "mission control" for running many Claude Code sessions at once,
inside a **single VS Code window** with a **vertical tab list** that shows each
session's **folder name** and **live status** (working / your turn / needs you).

No background service, no daemon, no network, no telemetry, no new software —
just VS Code's built-in terminal plus event-driven Claude Code hooks you already
have. See [docs/architecture.md](docs/architecture.md) for how it stays cheap and safe.

---

## The problem it solves

Running one standalone terminal per project means:
- many separate windows/tabs to hunt through;
- horizontal tabs **shrink** past ~5 and become unreadable;
- no way to see, at a glance, **which session is working and which is waiting for you**.

## The idea

| Pain | Fix |
|------|-----|
| Tabs shrink when there are many | VS Code's **vertical** tab list on the left - never shrinks |
| Can't tell which folder a tab is | Tab title = the **folder name** |
| Can't tell working vs waiting | A **status glyph** driven by Claude Code hooks: `⟳` working · `✓` your turn · `‼` needs you |
| Can't tell which model a session runs | A **coloured square** read from the transcript - follows `/model` live |
| Can't tell which tab is focused | `terminal.tab.activeBorder` paints a bright border on it |
| Typing a path to open a project | **`Alt+O`** — a floating picker of every project, most recently used first |
| Closing a session by mistake | **`Alt+Q`** asks *backup / close / keep*, and the trash icon now confirms first |
| Closing the whole window by mistake | `window.confirmBeforeClose: always` — VS Code asks before **any** window close, the mouse X included |
| Hebrew Markdown has no correct PDF | A **PDF button** on any `.md` toolbar exports it with RTL auto-detected |
| Reaching a folder means leaving the keyboard | **`Alt+E`** — a floating two-pane browser (tree ⟷ contents), all-keyboard, that runs a file with `F5` and drops a **Claude / Codex / Gemini / Copilot** terminal into any folder from its context menu |

## Quick start

One command installs (or updates) everything on any machine — Claude Code itself,
the VS Code settings/keybindings/hooks, and the extension:

```powershell
git clone https://github.com/idoyan-spec/claudeCodeManager.git
cd claudeCodeManager
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

`bootstrap.ps1` is idempotent: **run it again any time to update** to whatever was
added since (it `git pull`s first, then re-installs). Then open a **new** VS Code
window, press **`Alt+O`**, and pick a project.

<details><summary>Manual, step by step (if you don't want the umbrella script)</summary>

```powershell
# 1. Install (registers the `ccm` command + merges VS Code terminal settings, with backup)
E:\MAIN_CLAUDE\claudeCodeManager\scripts\install.ps1

# 2. Install the VS Code extension (Alt+O, close-guard, the RTL PDF button)
powershell -ExecutionPolicy Bypass -File .\ccm-extension\install-extension.ps1

# 3. Open a NEW VS Code window, then press Alt+O.  (Or: ccm E:\path\to\project)
```
</details>

Each project becomes a row in the vertical tab list, named by its folder, with a
live status glyph.

## `Alt+O` — the project picker

A floating list of every folder under `ccmHub.projectsRoot` (default
`E:\MAIN_CLAUDE`), **ordered by when you last worked in it**. Type to filter,
`Enter` to open: a new terminal starts Claude there and the picker closes. A
project that is already running shows `● running` and is simply focused rather
than opened twice.

"Last worked in" is the later of two facts, so the order is right on the very
first press and stays right no matter how a session was started:

- the picker's own history of what you opened through it, and
- the mtime of `~/.claude/projects/<encoded-cwd>/`, which Claude Code touches
  whenever it actually runs in that folder.

Configure with `ccmHub.projectsRoot` and `ccmHub.claudeCommand` in VS Code settings.

## `Alt+Q` — closing a session on purpose

A terminal is a live Claude session, and one stray click on the trash icon used
to end it. Two guards now stand in the way.

**`Alt+Q`** (also on both terminal context menus) asks three questions, naming the
folder it is about to close:

- **גבה וסגור** — runs `/session-backup` in that session, waits for it to finish,
  then closes the tab.
- **סגור** — closes it now.
- **השאר פתוח** — nothing. `Esc` means this too.

It closes the terminal on exactly one outcome: the backup finished. A timeout, a
cancellation, or Claude stopping to ask you something all leave the tab open.

**The trash icon** can't be intercepted — VS Code has no cancellable
"terminal is about to close" event for extensions. What it does have is
`terminal.integrated.confirmOnKill`, which the extension sets to `always` (its
default, `editor`, does not cover panel terminals — i.e. all of ours). And if a
session is killed anyway, you are offered it back: `claude --continue` reopens the
conversation from Claude's own transcript. Turn all of this off with
`ccmHub.guardTerminalClose: false`.

**Closing the whole window** has two layers. `terminal.integrated.confirmOnExit`
(set to `always`) makes VS Code's own X ask before it takes live *terminals*
down — but it stays silent when the window has none. So the extension also sets
**`window.confirmBeforeClose: "always"`**, VS Code's true "ask before every
close": verified in the desktop bundle to fire on *any* close, the mouse X
included (not only keyboard shortcuts, which is what its `keyboardOnly` value
limits it to). Its dialog has a *"do not ask again"* checkbox — tick it and the
setting flips to `never`, which the extension then respects (it only ever fills
an empty setting, never overrides your choice). Same `ccmHub.guardTerminalClose:
false` opts out of all of it.

## Export Markdown to PDF (with correct RTL)

Open any `.md` file and click the **PDF** button on the editor toolbar (top-right),
or right-click the file in the Explorer → *ccm: Export Markdown to PDF (RTL)*. A
`<name>.pdf` is written next to it and offered to open.

Why this exists: VS Code's Markdown **preview** shows Hebrew correctly but has **no
export**, and the code **editor** has no RTL mode at all (a years-open VS Code
feature request) — so a Hebrew document had no route to a right-aligned PDF. The
export renders with a vendored [marked](https://marked.js.org) (no npm, no network)
and prints with the **Edge/Chrome already on the machine** (`--print-to-pdf`), so
there is no Puppeteer and no second Chromium. Direction is **auto-detected**:
Hebrew/Arabic → RTL, otherwise LTR; code blocks stay LTR.

- **New to VS Code? Start here (Hebrew):** [VSCODE_GUIDE.html](VSCODE_GUIDE.html) — screen map, terminal, shortcuts
- **Full walk-through (Hebrew, non-technical):** [USER_GUIDE.html](USER_GUIDE.html) / [USER_GUIDE.md](USER_GUIDE.md)
- **Developer summary (Hebrew):** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **Setup details:** [docs/vscode-setup.md](docs/vscode-setup.md)

## The tab title: `<model> <status> <folder>`

Example: `🟨 ⟳ claudeCodeManager` — an Opus session that is working.

The `<folder>` is the project the session was **launched** in, not wherever it
happens to be right now. A session that `cd`s into a subfolder (say a website
stepping into `public/`) used to silently rename its tab `public`, losing which
project it even was. Now the project name is fixed at SessionStart and the
current subfolder is shown after a dash, like a breadcrumb:
`🟨 ⟳ mysite - public`. Back at the root it collapses to just `🟨 ⟳ mysite`.

| Glyph | Meaning | Hook that sets it |
|-------|---------|-------------------|
| `⟳` | Claude is working | `UserPromptSubmit`, `PostToolUse` |
| `✓` | Claude finished - your turn | `Stop` |
| `‼` | Claude needs you now (permission / prompt) | `Notification` (+ sound) |

| Square | Model |
|--------|-------|
| `🟨` | Opus |
| `🟦` | Fable |
| `🟥` | Haiku |
| `🟩` | Sonnet |

The model comes from the last non-sidechain assistant turn in the session
transcript, so it follows `/model` and a Haiku subagent never repaints an Opus
tab. It lives in the *title* rather than the tab colour because VS Code freezes
a terminal's colour and icon at creation — see [docs/architecture.md](docs/architecture.md).

## Layout

```
claudeCodeManager/
├── README.md                 this file
├── PROJECT_SUMMARY.md        developer summary (Hebrew)
├── VSCODE_GUIDE.html         "new to VS Code" onboarding (Hebrew)
├── USER_GUIDE.md             end-user manual (Hebrew)
├── USER_GUIDE.html           end-user manual, friendly HTML
├── docs/
│   ├── architecture.md       how it works + resource/security notes
│   └── vscode-setup.md       VS Code settings explained
├── vscode/
│   ├── settings-snippet.json terminal settings to merge
│   └── keybindings-snippet.json  terminal focus keys
├── ccm-extension/ccm-hub/
│   ├── extension.js          URI handler + Alt+O picker + the RTL PDF button
│   ├── build.js              the single source of truth for the build stamp
│   ├── projects.js           the "most recently used" ranking (pure Node, testable)
│   ├── browser/              the Alt+E file browser: index.js (host) + agents.js
│   │                         (agent registry & PATH probe) + fsops.js (disk, pure
│   │                         Node) + webview.{html,css,js} (panes, keys, menu)
│   └── md2pdf/               MD→PDF (RTL): render.js + vendored marked.min.js
├── scripts/
│   ├── bootstrap.ps1         one-command install/update for any machine
│   ├── ccm.ps1               the launcher
│   └── install.ps1           idempotent installer
└── hooks/                    SOURCE of the hooks; install.ps1 deploys them
```

> `hooks/` is the **source of truth**. `install.ps1` copies it to
> `~/.claude/skills/session-behavior/scripts/` *and registers the hook entries in*
> `~/.claude/settings.json`, so a fresh machine needs no hand-editing. Edit the
> deployed copy only and the repo starts lying.
