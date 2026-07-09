// ccm-hub  |  BUILD: 2026-07-10 00:31 v13 project-picker
// Opens a Claude Code session as a NEW integrated terminal in the CURRENT window,
// triggered by a vscode:// URI or by the Alt+O project picker. No SendKeys, no
// focus games — the Terminal API.
//
// URI:  vscode://ccm.hub/session?path=<percent-encoded folder>
// Key:  Alt+O  ->  ccmHub.openProjectPicker
//
// Status and model live in the tab TITLE, not here. VS Code freezes a terminal's
// icon and color at createTerminal() time — `Terminal` exposes no setter for
// either, and the command `workbench.action.terminal.changeIcon` ignores any
// argument (microsoft/vscode#239973 was rejected). So anything that has to track
// a running session is written by the ccm hooks as an OSC title sequence, which
// `terminal.integrated.tabs.title: "${sequence}"` renders. See docs/architecture.md.
//
// DO NOT pass `name` to createTerminal. It pins VS Code's `titleSource` to `Api`,
// and an Api title beats `${sequence}` permanently — the tab freezes on the name
// we passed and every OSC title the hooks write is ignored. That is exactly why
// ccm-hub tabs showed a bare folder name while a plain Ctrl+Shift+5 terminal in
// the same window showed `🟥 ✓ folder`. The tab is titled by the OSC below and
// then by the hooks; nothing else may claim the title.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { rankedProjects, ago } = require('./projects');

// A static icon so a Claude session is distinguishable from a plain shell tab.
const SESSION_ICON = new vscode.ThemeIcon('sparkle');

// Shown in the picker's title bar, so a glance confirms which build is running.
const BUILD = '2026-07-10 00:31 v13 project-picker';

const PICKER_COMMAND = 'ccmHub.openProjectPicker';
const MRU_KEY = 'ccmHub.mru';

// Live sessions this extension opened, keyed by folder path, so picking a folder
// that is already running focuses it instead of stacking a second Claude on it.
const sessions = new Map();

// A PowerShell literal for `s`, safe against quotes/`$`/backticks.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function cfg() {
  return vscode.workspace.getConfiguration('ccmHub');
}

function openSession(folder) {
  if (!folder) {
    vscode.window.showErrorMessage('ccm-hub: no folder path was provided.');
    return;
  }

  const existing = sessions.get(folder);
  if (existing) {
    existing.show();
    return;
  }

  const name = path.basename(folder.replace(/[\\/]+$/, '')) || folder;

  const term = vscode.window.createTerminal({
    cwd: folder,
    iconPath: SESSION_ICON
  });
  sessions.set(folder, term);
  term.show();

  // Name the tab immediately with a real OSC sequence, so it reads as the folder
  // before Claude's SessionStart hook lands. From then on the hooks own it.
  const osc = `Write-Host -NoNewline ([char]27 + ']0;' + ${psQuote(name)} + [char]7)`;
  const claudeCmd = cfg().get('claudeCommand') || 'claude --dangerously-skip-permissions';
  term.sendText(`${osc}; ${claudeCmd}`);
}

// The floating picker: every folder under `ccmHub.projectsRoot`, most recently
// entered first. Enter (or a click) opens it and the picker closes itself.
async function openProjectPicker(context) {
  const root = cfg().get('projectsRoot') || 'E:\\MAIN_CLAUDE';

  if (!fs.existsSync(root)) {
    const pick = await vscode.window.showErrorMessage(
      `ccm-hub: projects root not found: ${root}`,
      'Open settings'
    );
    if (pick) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ccmHub.projectsRoot');
    }
    return;
  }

  const mru = context.globalState.get(MRU_KEY, {});
  let projects;
  try {
    projects = rankedProjects(root, mru);
  } catch (err) {
    vscode.window.showErrorMessage(`ccm-hub: could not read ${root} — ${err.message}`);
    return;
  }

  if (!projects.length) {
    vscode.window.showInformationMessage(`ccm-hub: no folders under ${root}.`);
    return;
  }

  // A single clock reading, so two rows a millisecond apart cannot read "1m ago"
  // and "0m ago" for the same instant.
  const now = Date.now();
  const items = projects.map((p) => ({
    label: `$(folder) ${p.name}`,
    description: sessions.has(p.fsPath) ? `$(circle-filled) running` : ago(p.stamp, now),
    fsPath: p.fsPath
  }));

  const chosen = await vscode.window.showQuickPick(items, {
    title: `Claude Code — open project  ·  ccm ${BUILD}`,
    placeHolder: 'Most recently used first. Type to filter, Enter to open.',
    matchOnDescription: false
  });
  if (!chosen) return; // Esc — nothing opened, nothing recorded

  await context.globalState.update(MRU_KEY, { ...mru, [chosen.fsPath]: Date.now() });
  openSession(chosen.fsPath);
}

// A keybinding pressed while a TERMINAL has focus is forwarded to the shell unless
// its command sits in `terminal.integrated.commandsToSkipShell`. Our command is a
// custom id, so it is not in VS Code's 159-entry default list, and Alt+O would be
// swallowed by PowerShell — the picker would simply never appear. Verified in the
// 1.128 bundle: `let t = new Set(defaults); ...; t.add(r)` — the user's array is
// MERGED into the defaults (a `-` prefix removes), so appending one id is safe and
// destroys nothing.
//
// We do this from code rather than from the installer's settings merge, because
// the installer overwrites a key wholesale and would drop any ids the user added.
async function ensureSkipShell() {
  const conf = vscode.workspace.getConfiguration('terminal.integrated');
  const info = conf.inspect('commandsToSkipShell');
  const current = (info && info.globalValue) || [];
  if (current.includes(PICKER_COMMAND) || current.includes(`-${PICKER_COMMAND}`)) return;
  try {
    await conf.update(
      'commandsToSkipShell',
      [...current, PICKER_COMMAND],
      vscode.ConfigurationTarget.Global
    );
  } catch {
    /* read-only settings.json — the picker still works from the Command Palette */
  }
}

// VS Code stores the panel position PER WORKSPACE, as the numeric
// `workbench.panel.position` in that workspace's state.vscdb
// (0=left, 1=right, 2=bottom, 3=top — from the bundle's positionToString).
//
// So the guard must be per workspace too. It used to live in `globalState`:
// the very first folder opened after install got its panel moved, the flag
// flipped machine-wide, and every other folder kept its bottom panel forever.
// Measured: 4 of 5 recent workspaces still had `workbench.panel.position = 2`.
//
// `workbench.panel.defaultLocation: "top"` in settings.json covers workspaces
// that have no stored position yet; this converts the ones that do.
const PANEL_TOP_KEY = 'ccmHub.panelTopApplied';

function activate(context) {
  // Once per workspace: move the panel to the top. If the user later drags it
  // back, the flag is already set for this workspace and we never fight them.
  if (!context.workspaceState.get(PANEL_TOP_KEY)) {
    Promise.resolve(vscode.commands.executeCommand('workbench.action.positionPanelTop'))
      .then(
        () => context.workspaceState.update(PANEL_TOP_KEY, true),
        () => { /* command missing on this VS Code version — ignore */ }
      );
  }

  ensureSkipShell();

  // A terminal the user killed is not a session any more.
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [folder, term] of sessions) {
        if (term === t) sessions.delete(folder);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        // uri.query is the raw (encoded) query string; URLSearchParams decodes it.
        const params = new URLSearchParams(uri.query || '');
        openSession(params.get('path') || '');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(PICKER_COMMAND, () => openProjectPicker(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ccmHub.newSession', async () => {
      const picked = await vscode.window.showInputBox({
        prompt: 'Folder path for the new Claude session'
      });
      if (picked) openSession(picked);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
