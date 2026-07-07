# Claude Code Manager (ccm)

**Build:** `2026-07-07 v1 vscode-hub`

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
| Tabs shrink when there are many | VS Code's **vertical** tab list on the right - never shrinks |
| Can't tell which folder a tab is | Tab title = the **folder name** |
| Can't tell working vs waiting | A **status glyph** driven by Claude Code hooks: `⚙` working · `✅` your turn · `🔔` needs you |

## Quick start

```powershell
# 1. Install (registers the `ccm` command + merges VS Code terminal settings, with backup)
E:\MAIN_CLAUDE\claudeCodeManager\scripts\install.ps1

# 2. Open a NEW VS Code window (required - the title control is read at startup)

# 3. In the VS Code terminal, start a project session:
ccm E:\path\to\some\project
```

Open more projects by opening a new terminal tab (`Ctrl+Shift+5`) and running `ccm` again.
Each becomes a row in the vertical tab list, named by its folder, with a live status glyph.

- **Full walk-through (Hebrew, non-technical):** [USER_GUIDE.html](USER_GUIDE.html) / [USER_GUIDE.md](USER_GUIDE.md)
- **Developer summary (Hebrew):** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **Setup details:** [docs/vscode-setup.md](docs/vscode-setup.md)

## Status glyphs

| Glyph | Meaning | Hook that sets it |
|-------|---------|-------------------|
| `⚙`  | Claude is working | `UserPromptSubmit`, `PostToolUse` |
| `✅` | Claude finished - your turn | `Stop` |
| `🔔` | Claude needs you now (permission / prompt) | `Notification` (+ sound) |

## Layout

```
claudeCodeManager/
├── README.md                 this file
├── PROJECT_SUMMARY.md        developer summary (Hebrew)
├── USER_GUIDE.md             end-user manual (Hebrew)
├── USER_GUIDE.html           end-user manual, friendly HTML
├── docs/
│   ├── architecture.md       how it works + resource/security notes
│   └── vscode-setup.md       VS Code settings explained
├── vscode/
│   └── settings-snippet.json terminal settings to merge
├── scripts/
│   ├── ccm.ps1               the launcher
│   └── install.ps1           idempotent installer
└── hooks/                    reference copies of the live ~/.claude hooks
```

> The **live** hooks run from `~/.claude/skills/session-behavior/scripts/`.
> `hooks/` here is a documented snapshot, not the running copy.
