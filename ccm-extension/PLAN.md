# Plan — `ccm-hub` VS Code Extension

**Build:** `2026-07-09 v1 (plan)`
**Goal:** one-click from Explorer → a **new integrated terminal** appears in the
**existing VS Code "hub" window**, cwd = the clicked folder, Claude running in
auto mode — so every session collects in **one** window's vertical tab list with
status glyphs.

---

## Why an extension (the root reason)

VS Code has **no CLI** to "open a terminal in the existing window and run a
command." Every automation we tried collapsed into `SendKeys`, which caused all
the pain (keyboard layout, focus theft, lost files). An extension registers a
`vscode://` **URI handler** that does this directly through the Terminal API —
reliable, no keystrokes, no timing, no focus games.

## Design — buildless & portable

- **Plain JavaScript** extension (no TypeScript, no npm, no compile).
- **Install = copy a folder** to `%USERPROFILE%\.vscode\extensions\ccm-hub-0.0.1\`
  then reload VS Code. No toolchain, works on any machine.

```
ccm-extension/
  ccm-hub/
    package.json      # name=hub, publisher=ccm  -> URI authority "ccm.hub"
    extension.js      # registers the URI handler
    README.md
  install-extension.ps1     # copies ccm-hub -> ~/.vscode/extensions, no admin
  uninstall-extension.ps1
```

## How one click flows

1. **Explorer right-click** → launcher (`wscript`, no console window) runs:
   `code --open-url "vscode://ccm.hub/session?path=<url-encoded folder>"`
2. VS Code routes the URI to the extension's `UriHandler`.
3. Extension:
   - `folder = decode(path)`, `name = basename(folder)`
   - `term = window.createTerminal({ name, cwd: folder })`
   - `term.show()`
   - `term.sendText("claude --dangerously-skip-permissions")`
4. The existing **session-behavior hooks** paint the status glyph on the tab
   (`⚙` working · `✅` your turn · `🔔` needs you) — already built in ccm.

Result: click folder after folder → each becomes a new terminal **in the same
hub window**. Exactly the original goal.

## Maps to your task list

| Your task | How this plan addresses it |
|-----------|----------------------------|
| Unified terminals + tab list + status (the core need) | Extension adds terminals to one hub window; glyphs already exist via hooks |
| #1 keyboard stuck on English | Separate quick fix (my earlier test caused it); new launchers never touch layout |
| #2 status indicators in tab list | **Already built** in ccm hooks — verify it's active |
| #3 terminal color by model | VS Code allows per-terminal **tab color** (not full background). Deliver tab color by model (Fable=blue, Haiku=red, Sonnet=green, Opus=neutral). Needs the model per session → Phase 2 |
| #4 tab list to the **left** | One setting: `terminal.integrated.tabs.location: "left"` |
| #5 terminal panel on **top** | Extension runs `workbench.action.positionPanelTop` on activate |
| #6 test buttons e2e | Folded into Phase 1 verification |
| #7 portable install on 2nd machine | `install-extension.ps1` + existing context-menu installer |
| #8 backup + commit | After Phase 1 works |

## Phases

**Phase 0 — quick wins (minutes, no extension)**
- Fix the keyboard layout (back to Hebrew).
- Apply settings: tab list on the **left** (#4); verify status glyphs active (#2).

**Phase 1 — extension MVP (the core)**
- Build `ccm-hub` (package.json + extension.js: URI handler → new terminal → claude).
- `install-extension.ps1` (copy to extensions dir, no admin) + reload.
- Rewire the right-click entry to fire the `vscode://ccm.hub/session` URI.
- Panel-on-top on activate (#5).
- **Verify end-to-end:** two folders → two terminals in the same window.

**Phase 2 — polish**
- Tab color by model (#3).
- Command-palette entry + optional multi-window targeting.
- Prune/rename redundant menu entries; update README/TASKS; backup + commit (#8).

## To verify during build (known unknowns)

- `code --open-url` behavior when **no** VS Code window is open (may need to open a hub window first).
- URI authority must exactly equal `publisher.name` from package.json for a side-loaded extension.
- `createTerminal` cwd with spaces / Hebrew paths.
- Confirm hook OSC title (with glyph) wins over `createTerminal` name — which is the desired outcome.

## Non-goals (for now)

- Publishing to the VS Code Marketplace (local side-load only).
- Full per-terminal background image/color (VS Code API doesn't support it).
