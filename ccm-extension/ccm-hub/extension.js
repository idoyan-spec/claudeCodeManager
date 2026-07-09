// ccm-hub  |  BUILD: 2026-07-09 v1
// Opens a Claude Code session as a NEW integrated terminal in the CURRENT window,
// triggered by a vscode:// URI. No SendKeys, no focus games — the Terminal API.
//
// URI:  vscode://ccm.hub/session?path=<percent-encoded folder>&model=<optional>
const vscode = require('vscode');
const path = require('path');

function modelColor(model) {
  const m = (model || '').toLowerCase();
  if (m.indexOf('fable') >= 0)  return new vscode.ThemeColor('terminal.ansiBlue');
  if (m.indexOf('haiku') >= 0)  return new vscode.ThemeColor('terminal.ansiRed');
  if (m.indexOf('sonnet') >= 0) return new vscode.ThemeColor('terminal.ansiGreen');
  if (m.indexOf('opus') >= 0)   return new vscode.ThemeColor('terminal.ansiWhite');
  return undefined;
}

function openSession(folder, model) {
  if (!folder) {
    vscode.window.showErrorMessage('ccm-hub: no folder path was provided.');
    return;
  }
  const name = path.basename(folder.replace(/[\\/]+$/, '')) || folder;
  const opts = { name: name, cwd: folder };
  const color = modelColor(model);
  if (color) opts.color = color;

  const term = vscode.window.createTerminal(opts);
  term.show();
  // Start Claude in auto mode. The session-behavior hooks then own the tab
  // title (folder name + status glyph).
  term.sendText('claude --dangerously-skip-permissions');
}

function activate(context) {
  // One-time: move the panel to the top (task #5). Respect later user changes
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
        const folder = params.get('path') || '';
        const model = params.get('model') || '';
        openSession(folder, model);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ccmHub.newSession', async () => {
      const picked = await vscode.window.showInputBox({
        prompt: 'Folder path for the new Claude session'
      });
      if (picked) openSession(picked, '');
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
