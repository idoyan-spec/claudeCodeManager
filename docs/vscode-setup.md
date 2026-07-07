# VS Code setup

**Build:** `2026-07-07 v1 vscode-hub`

`install.ps1` applies these for you (with a backup). This page explains each key
so you can verify or apply them by hand via **File → Preferences → Settings →
"Open Settings (JSON)"**.

```jsonc
{
  // Show the terminal tab list as a vertical strip on the RIGHT - it never
  // shrinks the way horizontal tabs do.
  "terminal.integrated.tabs.enabled": true,
  "terminal.integrated.tabs.location": "right",
  "terminal.integrated.tabs.hideCondition": "never",

  // Use the title our hooks set via escape sequence -> "<status> <folder>".
  "terminal.integrated.tabs.title": "${sequence}",
  "terminal.integrated.tabs.description": "",

  // Keep terminals across a window reload so the hub survives a restart.
  "terminal.integrated.enablePersistentSessions": true
}
```

## Notes

- `${sequence}` is the title the shell/hooks set. If you ever see the raw process
  name instead, a session hasn't set its title yet — it updates on the next event.
- Widen the tab strip by dragging its edge if folder names are long.
- To turn off VS Code's shell-integration decorations (optional, purely cosmetic):
  `"terminal.integrated.shellIntegration.enabled": false`. It does **not** affect
  what the terminal can do.
- These settings are per-user and local; nothing is shared or uploaded.

## Verifying it works (in a NEW window)

1. Open a **new** VS Code window (so `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` is read).
2. Open a terminal, run `ccm <some-folder>`.
3. The tab on the right should read the folder name.
4. Type a prompt → the tab shows `⚙`. When Claude finishes → `✅`. When it asks
   permission → `🔔` plus a sound.

If titles don't change inside VS Code, set `CCM_TITLE_MODE=ps` (PowerShell path)
or `tty` to force a mode, then reopen the window.
