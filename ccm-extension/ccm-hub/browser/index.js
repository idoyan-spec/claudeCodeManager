// ccm-hub / browser/index.js  |  see ../build.js for the build stamp
//
// The host half of the Alt+E file browser: it owns the panel, the disk, and
// every action the webview asks for. The webview owns the pixels and the
// keyboard, and nothing else — see webview.js.
//
// WHY A WEBVIEW PANEL AND NOT A REAL FLOATING WINDOW:
// the extension API exposes no floating window. `createWebviewPanel` is the only
// surface an extension can paint freely, and it lands in the editor area as a
// tab. What makes it *behave* like the floating picker that was asked for is the
// combination used here and already proven by the explain card in extension.js:
//   * it takes focus on open (preserveFocus: false),
//   * it paints a centred card over a dimmed backdrop, so it reads as floating,
//   * Esc and the ✕ close it,
//   * and onDidChangeViewState disposes it the moment it stops being active —
//     one click on the terminal, the editor, or another tab and it is gone.
// (VS Code 1.85+ can move an editor into an OS-level auxiliary window, but that
// window has no "close when you touch something else" semantics at all — it is
// a window, so it stays. It would break the requirement, not serve it.)

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { BUILD } = require('../build');
const { listAgents } = require('./agents');
const fsops = require('./fsops');

// One browser at a time. A second Alt+E reveals the open one instead of
// stacking a second copy of the same tree.
let current = null;

function cfg() {
  return vscode.workspace.getConfiguration('ccmHub');
}

// A PowerShell literal, safe against quotes. Same rule as extension.js.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function shQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

// An argv turned into one command line for the shell the terminal is running.
// Windows gets PowerShell's call operator, which is what makes a quoted path
// with spaces executable at all (`'C:\my app\x.exe'` alone is just a string).
function commandLine(argv) {
  if (process.platform === 'win32') {
    return '& ' + argv.map(psQuote).join(' ');
  }
  return argv.map(shQuote).join(' ');
}

function oscTitle(name) {
  if (process.platform === 'win32') {
    return `Write-Host -NoNewline ([char]27 + ']0;' + ${psQuote(name)} + [char]7)`;
  }
  return `printf '\\033]0;%s\\007' ${shQuote(name)}`;
}

// The folders the tree starts from: the open workspace, or — when VS Code has no
// folder open — the same projects root the Alt+O picker uses, so the browser is
// never empty.
function browserRoots() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length) {
    return folders.map((f) => ({ name: f.name, path: f.uri.fsPath }));
  }
  const root = cfg().get('projectsRoot') || 'E:\\MAIN_CLAUDE';
  return fs.existsSync(root) ? [{ name: path.basename(root) || root, path: root }] : [];
}

// Where to land. The folder of the file being edited is almost always what the
// user means by "the folders in the project", so prefer it when it sits inside a
// root; otherwise the first root.
function startFolder(roots) {
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === 'file') {
    const dir = path.dirname(ed.document.uri.fsPath);
    for (const r of roots) {
      if (fsops.ancestryWithin(r.path, dir).length) return dir;
    }
  }
  return roots.length ? roots[0].path : '';
}

function agentsNow() {
  return listAgents({
    custom: cfg().get('browser.agents'),
    claudeCommand: cfg().get('claudeCommand')
  });
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

// A terminal parked in `dir`, optionally running `cmd`. `label` names the tab.
//
// Unlike the Claude sessions in extension.js, naming these IS correct: no hook
// writes an OSC title into a plain run terminal, so without a name the tab would
// read "powershell" and three runs would be indistinguishable. The OSC write is
// kept anyway for the agent terminals, where a hook may later take the title over.
function spawnTerminal({ dir, cmd, label, icon }) {
  const term = vscode.window.createTerminal({
    cwd: dir,
    name: label,
    iconPath: icon ? new vscode.ThemeIcon(icon) : undefined
  });
  term.show();
  if (cmd) term.sendText(cmd);
  return term;
}

function runFile(fsPath) {
  const dir = path.dirname(fsPath);
  const argv = fsops.runnerFor(fsPath);
  if (!argv) {
    // No known runner: hand it to the operating system, exactly as a
    // double-click in Explorer would.
    vscode.env.openExternal(vscode.Uri.file(fsPath));
    return;
  }
  spawnTerminal({
    dir,
    cmd: commandLine(argv),
    label: `▶ ${path.basename(fsPath)}`,
    icon: 'play'
  });
}

function openAgentTerminal(agent, dir, deps) {
  if (!agent) return;
  // Claude goes through the session machinery in extension.js so the close
  // guard, the restore offer and the "already running here" check all apply.
  if (agent.id === 'claude' && deps && deps.openClaudeSession) {
    deps.openClaudeSession(dir);
    return;
  }
  const folderName = path.basename(dir.replace(/[\\/]+$/, '')) || dir;
  const term = vscode.window.createTerminal({
    cwd: dir,
    name: `${agent.glyph} ${folderName}`,
    iconPath: new vscode.ThemeIcon('sparkle')
  });
  term.show();
  term.sendText(`${oscTitle(`${agent.glyph} ${folderName}`)}; ${agent.command}`);
}

function installAgent(agent) {
  if (!agent) return;
  if (!agent.pkg) {
    vscode.window.showInformationMessage(
      `ccm: ${agent.label} — ${agent.installHint || 'אין התקנה אוטומטית לסוכן הזה.'}`
    );
    return;
  }
  spawnTerminal({
    dir: undefined,
    cmd: `npm install -g ${agent.pkg}`,
    label: `⬇ ${agent.label}`,
    icon: 'cloud-download'
  });
  vscode.window.showInformationMessage(
    `ccm: מתקין ${agent.label}. אחרי שההתקנה תסתיים — פתח חלון VS Code חדש כדי ש-PATH המעודכן ייקלט.`
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function html(extensionPath) {
  const dir = path.join(extensionPath, 'browser');
  const shell = fs.readFileSync(path.join(dir, 'webview.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'webview.css'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'webview.js'), 'utf8');
  // A replacer FUNCTION, not a replacement string: '$&' and '$1' inside the CSS
  // or the script would otherwise be expanded by String.replace as capture
  // references and silently corrupt the file.
  return shell.replace('__CSS__', () => css).replace('__JS__', () => js);
}

function openFileBrowser(context, deps = {}) {
  if (current) {
    current.reveal(vscode.ViewColumn.Active, false);
    return current;
  }

  const roots = browserRoots();
  if (!roots.length) {
    vscode.window.showWarningMessage(
      'ccm: אין תיקייה פתוחה ולא נמצא projectsRoot — אין מה להציג בסייר.'
    );
    return undefined;
  }

  const panel = vscode.window.createWebviewPanel(
    'ccmBrowser',
    '🗂 סייר הפרויקט',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: false }
  );
  current = panel;
  panel.webview.html = html(context.extensionPath);

  const send = (msg) => panel.webview.postMessage(msg);

  // Re-listing after a change is one call, used by every mutation below so the
  // pane the user is looking at is never stale.
  const sendDir = (dirPath, showHidden, selectName) => {
    try {
      send({
        type: 'dir',
        path: dirPath,
        parent: fsops.parentOf(dirPath),
        entries: fsops.readDir(dirPath, { showHidden })
      });
      if (selectName) send({ type: 'selectName', name: selectName });
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
  };

  panel.webview.onDidReceiveMessage(async (m) => {
    if (!m) return;
    const showHidden = !!m.showHidden;

    try {
      switch (m.type) {
        case 'ready':
          send({
            type: 'init',
            build: BUILD,
            sep: path.sep,
            roots,
            agents: agentsNow(),
            enterRuns: cfg().get('browser.enterRuns', false),
            showHidden: cfg().get('browser.showHidden', false),
            start: startFolder(roots)
          });
          return;

        case 'kids':
          try {
            send({ type: 'kids', path: m.path, entries: fsops.readSubdirs(m.path, { showHidden }) });
          } catch {
            // An unreadable folder (permissions, a disconnected drive) must not
            // break the tree — it just has no children.
            send({ type: 'kids', path: m.path, entries: [] });
          }
          return;

        case 'dir':
          sendDir(m.path, showHidden);
          return;

        case 'close':
          panel.dispose();
          return;

        case 'act':
          break;

        default:
          return;
      }

      const uri = m.path ? vscode.Uri.file(m.path) : undefined;

      switch (m.act) {
        case 'open':
          await vscode.commands.executeCommand('vscode.open', uri);
          panel.dispose();
          break;

        case 'run':
          runFile(m.path);
          panel.dispose();
          break;

        case 'external':
          await vscode.env.openExternal(uri);
          panel.dispose();
          break;

        case 'pdf':
          panel.dispose();
          if (deps.exportMarkdownPdf) await deps.exportMarkdownPdf(uri);
          break;

        case 'shell':
          spawnTerminal({ dir: m.path, label: `❯ ${path.basename(m.path)}`, icon: 'terminal' });
          panel.dispose();
          break;

        case 'agent': {
          const agent = agentsNow().find((a) => a.id === m.agentId);
          openAgentTerminal(agent, m.path, deps);
          panel.dispose();
          break;
        }

        case 'installAgent':
          installAgent(agentsNow().find((a) => a.id === m.agentId));
          panel.dispose();
          break;

        case 'reveal':
          await vscode.commands.executeCommand('revealFileInOS', uri);
          break;

        case 'window':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          break;

        case 'copy':
          await vscode.env.clipboard.writeText(String(m.text || ''));
          send({ type: 'status', message: 'הועתק ללוח' });
          break;

        case 'newFile': {
          const target = path.join(m.path, m.name);
          if (fs.existsSync(target)) {
            send({ type: 'status', message: 'כבר קיים פריט בשם הזה' });
            break;
          }
          await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new Uint8Array());
          sendDir(m.path, showHidden, m.name);
          break;
        }

        case 'newFolder': {
          const target = path.join(m.path, m.name);
          if (fs.existsSync(target)) {
            send({ type: 'status', message: 'כבר קיימת תיקייה בשם הזה' });
            break;
          }
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(target));
          sendDir(m.path, showHidden, m.name);
          break;
        }

        case 'rename': {
          const dir = path.dirname(m.path);
          const target = path.join(dir, m.name);
          // `overwrite: false` is the point — a rename must never silently eat
          // an existing file, and the webview has no way to know one is there.
          await vscode.workspace.fs.rename(uri, vscode.Uri.file(target), { overwrite: false });
          sendDir(dir, showHidden, m.name);
          break;
        }

        case 'delete': {
          const dir = path.dirname(m.path);
          await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
          sendDir(dir, showHidden);
          send({ type: 'status', message: 'נמחק (סל המיחזור)' });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      send({ type: 'status', message: `שגיאה: ${err && err.message}` });
    }
  }, undefined, context.subscriptions);

  // The close-on-blur behaviour. The first state change is the panel becoming
  // active; only a LOSS of active closes it.
  panel.onDidChangeViewState((e) => {
    if (!e.webviewPanel.active) panel.dispose();
  }, undefined, context.subscriptions);

  panel.onDidDispose(() => {
    if (current === panel) current = null;
  }, undefined, context.subscriptions);

  return panel;
}

module.exports = { openFileBrowser, commandLine, browserRoots };
