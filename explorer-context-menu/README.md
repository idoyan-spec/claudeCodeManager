# Explorer Context Menu for Claude Code

**Build:** `2026-07-09 v1`

Adds two right-click entries in Windows Explorer so you can drop straight into
Claude Code from any folder:

| Menu entry | What it does |
|------------|--------------|
| **Open in Claude Code (Auto)** | Opens **Windows Terminal** with `claude --dangerously-skip-permissions` running in that folder |
| **Open in Claude Code (VS Code)** | Opens the folder in **VS Code** *and* a Windows Terminal running Claude beside it |

Both appear whether you right-click **on** a folder or **inside** an open folder.

---

## Why it is built this way

Earlier attempts drove VS Code with simulated keystrokes (`SendKeys`). That was
fragile and caused real problems, so this version deliberately avoids it:

- **No keystroke automation** — the launchers just start `wt.exe` / `Code.exe`
  directly. Moving the mouse or typing during startup cannot break anything.
- **No console flicker** — launchers are `.vbs`, run by `wscript.exe`, which
  shows **no window at all**.
- **No admin required** — installs to `HKCU\Software\Classes` (per-user), which
  Explorer merges into the context menu.
- **Non-destructive** — the VS Code launcher never uses `--reuse-window`, so it
  can never replace/close files you already have open.
- **Portable** — the VS Code launcher detects VS Code's location at runtime.

## Install (on any Windows machine)

```powershell
powershell -ExecutionPolicy Bypass -File .\install-context-menu.ps1
```

The installer copies the launchers to `%USERPROFILE%\.claude\ccm-launchers\`
and registers the menu entries. No restart needed — right-click a folder.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-context-menu.ps1
```

Removes the per-user entries, and (elevating only if needed) any legacy
machine-wide entries from earlier experiments.

## Requirements

- **Windows Terminal** (`wt.exe`) — ships with Windows 11; installable from the Store on Windows 10.
- **Claude Code CLI** (`claude.exe`) on `PATH`.
- **VS Code** — only for the "(VS Code)" entry; auto-detected.

## Files

```
explorer-context-menu/
  launchers/
    claude-terminal.vbs     # wt + claude (auto)
    claude-vscode.vbs       # VS Code + wt/claude, detects VS Code
  install-context-menu.ps1  # per-user, no admin
  uninstall-context-menu.ps1
  README.md
  TASK.md
```
