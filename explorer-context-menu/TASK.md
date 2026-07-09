# TASK — Explorer Context Menu for Claude Code

**Build:** `2026-07-09 v1`
**Status:** functional; portable installer ready; pending user confirmation on this machine.

## Goal

One-click entry into Claude Code from Windows Explorer's right-click menu, on
this machine and easily reproducible on **other machines**.

## Requirements (from the user)

1. Right-click a folder → open Claude Code in **auto mode** (no permission prompts).
2. A **terminal** flavor (Windows Terminal with Claude) and a **VS Code** flavor
   (VS Code + a Claude terminal beside it).
3. **Elegant**: no flickering console window, no long delay, nothing that breaks
   if the mouse/keyboard is touched during startup.
4. **Non-destructive**: never close/replace already-open VS Code files.
5. **Portable**: works on other computers with minimal setup.

## Design decisions

- **VBScript launchers via `wscript.exe`** → zero visible console window.
- **Direct process launch** (`wt.exe`, `Code.exe`) instead of `SendKeys` →
  immune to focus/keyboard-layout/timing problems.
- **`HKCU\Software\Classes`** install → no admin rights needed; per-user.
- **Runtime launcher copy** to `%USERPROFILE%\.claude\ccm-launchers\` → registry
  is independent of where the repo lives.
- VS Code path **auto-detected** at runtime (LOCALAPPDATA / Program Files).

## History / lessons learned

- Simulated keystrokes (`SendKeys`) failed repeatedly:
  - PowerShell backtick escaping broke the script (parse error → instant exit).
  - VS Code is Electron → `MainWindowHandle` is always `0` (had to match window by owning PID).
  - Window-title search wrongly matched a **Chrome tab** containing "Visual Studio Code".
  - Hebrew keyboard layout mangled typed text (`.` → `ץ`) and killed the terminal shortcut.
  - `--reuse-window` (`-r`) **closed unsaved files** — data loss. Removed entirely.
- Conclusion: **abandon keystroke automation**; launch processes directly.

## Done

- [x] `claude-terminal.vbs` launcher (wt + claude, auto).
- [x] `claude-vscode.vbs` launcher (VS Code + wt/claude, VS Code auto-detect).
- [x] `install-context-menu.ps1` (per-user, no admin, copies launchers, writes registry).
- [x] `uninstall-context-menu.ps1` (removes per-user + legacy HKCR entries).
- [x] Removed the broken `code.exe "%V"` menu entry.
- [x] README + this TASK doc.

## To verify / next

- [ ] Run installer on this machine; confirm both entries work end-to-end.
- [ ] Remove leftover legacy HKCR entries so no duplicate buttons remain.
- [ ] Test the portable install on a second machine.
- [ ] Optional: a matching install step inside the main `ccm` installer.
