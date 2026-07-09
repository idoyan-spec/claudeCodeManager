// test-extension.js  |  BUILD: 2026-07-10 00:31 v13 project-picker
//
// Runs the extension against a stubbed `vscode` module, with no VS Code involved.
//
//   node ccm-extension/test-extension.js
//
// Nothing here writes to disk: the only real I/O is reading ~/.claude/projects to
// rank the projects, which is exactly what we want to exercise.
//
// The invariant worth the whole file: `createTerminal` must never be given a
// `name`. Doing so pins VS Code's titleSource to `Api`, which permanently beats
// `${sequence}` and freezes the tab — the hooks' status glyphs then silently stop
// appearing. That regression shipped once (fixed in v6); this test makes it loud.

const Module = require('module');
const path = require('path');

const EXT_DIR = path.join(__dirname, 'ccm-hub');
const ROOT = 'E:\\MAIN_CLAUDE';

let failures = 0;
function assert(name, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && extra ? '\n          -> ' + extra : ''));
  if (!cond) failures++;
}

// ---- the fake `vscode` -----------------------------------------------------
const log = [];
let quickPickItems = null;
let quickPickChoice = null;
const settingsStore = { 'terminal.integrated': { commandsToSkipShell: ['existing.user.command'] } };

const vscodeStub = {
  ThemeIcon: class { constructor(id) { this.id = id; } },
  ConfigurationTarget: { Global: 1 },
  commands: {
    _handlers: {},
    registerCommand(id, fn) { this._handlers[id] = fn; return { dispose() {} }; },
    executeCommand(id) { log.push('executeCommand:' + id); return Promise.resolve(); }
  },
  window: {
    _terms: [],
    createTerminal(opts) {
      log.push('createTerminal:' + opts.cwd + ' name=' + (opts.name === undefined ? '<none>' : opts.name));
      const t = { opts, show: () => log.push('show:' + opts.cwd), sendText: (s) => log.push('sendText:' + s) };
      this._terms.push(t);
      return t;
    },
    showQuickPick(items, opts) {
      quickPickItems = items;
      log.push('quickPick.title=' + opts.title);
      return Promise.resolve(quickPickChoice === null ? undefined : items[quickPickChoice]);
    },
    showInputBox: () => Promise.resolve(undefined),
    showErrorMessage: (m) => { log.push('ERROR:' + m); return Promise.resolve(undefined); },
    showInformationMessage: (m) => { log.push('INFO:' + m); return Promise.resolve(undefined); },
    registerUriHandler(h) { this._uri = h; return { dispose() {} }; },
    onDidCloseTerminal(fn) { this._onClose = fn; return { dispose() {} }; }
  },
  workspace: {
    getConfiguration(section) {
      if (section === 'ccmHub') {
        const vals = { projectsRoot: ROOT, claudeCommand: 'claude --dangerously-skip-permissions' };
        return { get: (k) => vals[k] };
      }
      return {
        inspect: (k) => ({ globalValue: settingsStore[section] && settingsStore[section][k] }),
        update: (k, v) => {
          settingsStore[section][k] = v;
          log.push('settings.update:' + k + '=' + JSON.stringify(v));
          return Promise.resolve();
        }
      };
    }
  }
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? 'vscode-stub' : origResolve.call(this, req, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscodeStub };

const ext = require(path.join(EXT_DIR, 'extension.js'));
const { rankedProjects, encodeProjectDir, ago } = require(path.join(EXT_DIR, 'projects.js'));

const store = {};
const context = {
  subscriptions: [],
  globalState: { get: (k, d) => (k in store ? store[k] : d), update: (k, v) => { store[k] = v; return Promise.resolve(); } },
  workspaceState: { get: () => false, update: () => Promise.resolve() }
};

const tick = () => new Promise((r) => setTimeout(r, 40));

(async () => {
  console.log('\nranking (pure, no vscode)');
  assert("'\\' and '/' encode identically",
    encodeProjectDir('E:\\a\\b') === encodeProjectDir('E:/a/b'));
  assert('a known folder maps to its history dir',
    encodeProjectDir('E:\\MAIN_CLAUDE\\claudeCodeManager') === 'E--MAIN-CLAUDE-claudeCodeManager');
  const ranked = rankedProjects(ROOT, {});
  assert('finds projects', ranked.length > 0, 'found ' + ranked.length);
  assert('sorted by stamp, descending',
    ranked.every((p, i) => i === 0 || ranked[i - 1].stamp >= p.stamp));
  assert('never-run folders sort last',
    ranked.filter((p) => p.stamp === 0).every((_, i, arr) => ranked.indexOf(arr[0]) >= ranked.filter((q) => q.stamp > 0).length));
  const forced = rankedProjects(ROOT, { [path.join(ROOT, ranked[ranked.length - 1].name)]: Date.now() });
  assert('an MRU entry beats history', forced[0].name === ranked[ranked.length - 1].name, forced[0].name);
  assert('ago() has no future/negative output', ago(Date.now() + 60000, Date.now()) === 'just now');
  assert('ago() marks unseen folders', ago(0, Date.now()) === 'never opened');

  console.log('\nactivate()');
  ext.activate(context);
  await tick();
  assert('panel moved to top', log.includes('executeCommand:workbench.action.positionPanelTop'));
  const upd = log.find((l) => l.startsWith('settings.update:commandsToSkipShell'));
  assert('registers itself in commandsToSkipShell', !!upd);
  assert("keeps the user's existing skip-shell entries",
    !!upd && upd.includes('existing.user.command') && upd.includes('ccmHub.openProjectPicker'), upd);

  log.length = 0;
  ext.activate(context);
  await tick();
  assert('the skip-shell write is idempotent', !log.some((l) => l.startsWith('settings.update:')));

  console.log('\npicker');
  log.length = 0;
  quickPickChoice = null;
  await vscodeStub.commands._handlers['ccmHub.openProjectPicker']();
  assert('title carries the build stamp', log.some((l) => l.includes('v13 project-picker')));
  assert('Esc opens nothing', !log.some((l) => l.startsWith('createTerminal')));
  assert('Esc records no MRU', !('ccmHub.mru' in store));

  log.length = 0;
  quickPickChoice = 0;
  await vscodeStub.commands._handlers['ccmHub.openProjectPicker']();
  const created = log.find((l) => l.startsWith('createTerminal:'));
  assert('choosing opens a terminal', !!created);
  assert('createTerminal is given NO name (titleSource must not become Api)',
    !!created && created.includes('name=<none>'), created);
  const sent = log.find((l) => l.startsWith('sendText:'));
  assert('sets the OSC title before running claude', !!sent && sent.indexOf(']0;') < sent.indexOf('claude'), sent);
  assert('runs the configured claude command', !!sent && sent.includes('claude --dangerously-skip-permissions'));
  assert('records the MRU', !!store['ccmHub.mru'] && Object.keys(store['ccmHub.mru']).length === 1);

  const before = vscodeStub.window._terms.length;
  log.length = 0;
  await vscodeStub.commands._handlers['ccmHub.openProjectPicker']();
  assert('a running project is not opened twice', vscodeStub.window._terms.length === before);
  assert('a running project is focused instead', log.some((l) => l.startsWith('show:')));
  assert('a running project is labelled', quickPickItems[0].description.includes('running'), quickPickItems[0].description);

  vscodeStub.window._onClose(vscodeStub.window._terms[0]);
  log.length = 0;
  await vscodeStub.commands._handlers['ccmHub.openProjectPicker']();
  assert('a closed session can be reopened', log.some((l) => l.startsWith('createTerminal:')));

  console.log('\nuri handler');
  log.length = 0;
  vscodeStub.window._uri.handleUri({ query: 'path=' + encodeURIComponent('E:\\MAIN_CLAUDE\\ColorMatch') });
  assert('opens the decoded folder', log.some((l) => l === 'createTerminal:E:\\MAIN_CLAUDE\\ColorMatch name=<none>'), JSON.stringify(log));

  log.length = 0;
  vscodeStub.window._uri.handleUri({ query: '' });
  assert('an empty path errors and opens nothing',
    log.some((l) => l.startsWith('ERROR:')) && !log.some((l) => l.startsWith('createTerminal')));

  log.length = 0;
  vscodeStub.window._uri.handleUri({ query: 'path=' + encodeURIComponent("E:\\tmp\\it's; rm -rf x") });
  const evil = log.find((l) => l.startsWith('sendText:'));
  assert("a quote in the folder name stays inside the PowerShell literal", !!evil && evil.includes("it''s"), evil);

  console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
})();
