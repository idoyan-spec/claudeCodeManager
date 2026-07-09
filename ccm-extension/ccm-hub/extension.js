// ccm-hub  |  BUILD: 2026-07-09 v6 no-api-name
// Opens a Claude Code session as a NEW integrated terminal in the CURRENT window,
// triggered by a vscode:// URI. No SendKeys, no focus games — the Terminal API.
//
// URI:  vscode://ccm.hub/session?path=<percent-encoded folder>
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

// A static icon so a Claude session is distinguishable from a plain shell tab.
const SESSION_ICON = new vscode.ThemeIcon('sparkle');

// A PowerShell literal for `s`, safe against quotes/`$`/backticks.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function openSession(folder) {
  if (!folder) {
    vscode.window.showErrorMessage('ccm-hub: no folder path was provided.');
    return;
  }
  const name = path.basename(folder.replace(/[\\/]+$/, '')) || folder;

  const term = vscode.window.createTerminal({
    cwd: folder,
    iconPath: SESSION_ICON
  });
  term.show();

  // Name the tab immediately with a real OSC sequence, so it reads as the folder
  // before Claude's SessionStart hook lands. From then on the hooks own it.
  const osc = `Write-Host -NoNewline ([char]27 + ']0;' + ${psQuote(name)} + [char]7)`;
  term.sendText(`${osc}; claude --dangerously-skip-permissions`);
}

function activate(context) {
  // One-time: move the panel to the top (task #3). Respect later user changes
  // by guarding on globalState so we never fight the user's own choice.
  if (!context.globalState.get('ccmHub.panelTopApplied')) {
    Promise.resolve(vscode.commands.executeCommand('workbench.action.positionPanelTop'))
      .then(
        () => context.globalState.update('ccmHub.panelTopApplied', true),
        () => { /* command missing on this VS Code version — ignore */ }
      );
  }

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
