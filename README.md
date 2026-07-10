# Claude Code Manager (ccm)

**Build:** `2026-07-10 09:04 v14 close-guard`

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

## Quick start

```powershell
# 1. Install (registers the `ccm` command + merges VS Code terminal settings, with backup)
E:\MAIN_CLAUDE\claudeCodeManager\scripts\install.ps1

# 2. Install the VS Code extension (gives you Alt+O and the right-click entry)
powershell -ExecutionPolicy Bypass -File .\ccm-extension\install-extension.ps1

# 3. Open a NEW VS Code window (required - the title control is read at startup)

# 4. Press Alt+O and pick a project.  (Or type: ccm E:\path\to\some\project)
```

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

- **New to VS Code? Start here (Hebrew):** [VSCODE_GUIDE.html](VSCODE_GUIDE.html) — screen map, terminal, shortcuts
- **Full walk-through (Hebrew, non-technical):** [USER_GUIDE.html](USER_GUIDE.html) / [USER_GUIDE.md](USER_GUIDE.md)
- **Developer summary (Hebrew):** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **Setup details:** [docs/vscode-setup.md](docs/vscode-setup.md)

## The tab title: `<model> <status> <folder>`

Example: `🟨 ⟳ claudeCodeManager` — an Opus session that is working.

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
│   ├── extension.js          URI handler + the Alt+O picker
│   └── projects.js           the "most recently used" ranking (pure Node, testable)
├── scripts/
│   ├── ccm.ps1               the launcher
│   └── install.ps1           idempotent installer
└── hooks/                    SOURCE of the hooks; install.ps1 deploys them
```

> `hooks/` is the **source of truth**. `install.ps1` copies it to
> `~/.claude/skills/session-behavior/scripts/` *and registers the hook entries in*
> `~/.claude/settings.json`, so a fresh machine needs no hand-editing. Edit the
> deployed copy only and the repo starts lying.
