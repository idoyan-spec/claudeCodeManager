// ccm-hub  |  BUILD: 2026-07-09 v3 status-icons
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
const vscode = require('vscode');
const path = require('path');

// A static icon so a Claude session is distinguishable from a plain shell tab.
const SESSION_ICON = new vscode.ThemeIcon('sparkle');

function openSession(folder) {
  if (!folder) {
    vscode.window.showErrorMessage('ccm-hub: no folder path was provided.');
    return;
  }
  const name = path.basename(folder.replace(/[\\/]+$/, '')) || folder;

  const term = vscode.window.createTerminal({
    name: name,
    cwd: folder,
    iconPath: SESSION_ICON
  });
  term.show();
  // Start Claude in auto mode. The session-behavior hooks then own the tab
  // title: "<model square> <status glyph> <folder>".
  term.sendText('claude --dangerously-skip-permissions');
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
