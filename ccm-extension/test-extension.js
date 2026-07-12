// test-extension.js  |  BUILD: 2026-07-13 12:40 v17 window-close-guard
//
// Runs the extension against a stubbed `vscode` module, with no VS Code involved.
//
//   node ccm-extension/test-extension.js
//
// Nothing here writes to disk: the only real I/O is reading ~/.claude/projects to
// rank the projects, which is exactly what we want to exercise.
//
// Two invariants are worth the whole file:
//
//   1. `createTerminal` must never be given a `name`. Doing so pins VS Code's
//      titleSource to `Api`, which permanently beats `${sequence}` and freezes the
//      tab — the hooks' status glyphs then silently stop appearing. That regression
//      shipped once (fixed in v6); this test makes it loud.
//
//   2. `backupThenClose` closes the terminal on exactly ONE outcome: the hooks
//      reported the backup finished. Timeout, cancel, a question from Claude, a
//      stale ✓ left over from before the backup was even submitted — every one of
//      those must leave the terminal open. A feature whose entire purpose is "do
//      not lose a terminal by accident" must never lose a terminal by accident.

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
let warningChoice = null; // index into the items passed to showWarningMessage
let lastWarningItems = null;
let lastWarningMessage = null;
let cancelProgressAfterMs = null;
let lastWebview = null;
const settingsStore = { 'terminal.integrated': { commandsToSkipShell: ['existing.user.command'] } };
const ccmSettings = { projectsRoot: ROOT, claudeCommand: 'claude --dangerously-skip-permissions' };

function makeTerminal(opts) {
  const t = {
    opts,
    name: '',
    exitStatus: undefined,
    show: () => log.push('show:' + opts.cwd),
    sendText: (s) => log.push('sendText:' + s),
    dispose() {
      log.push('dispose:' + opts.cwd);
      this.exitStatus = { code: 0, reason: vscodeStub.TerminalExitReason.Extension };
      if (vscodeStub.window._onClose) vscodeStub.window._onClose(this);
    }
  };
  return t;
}

const vscodeStub = {
  ThemeIcon: class { constructor(id) { this.id = id; } },
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1, Beside: -2 },
  env: { clipboard: { writeText: (t) => { log.push('clipboard.write:' + t); return Promise.resolve(); } } },
  TerminalExitReason: { Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4 },
  commands: {
    _handlers: {},
    registerCommand(id, fn) { this._handlers[id] = fn; return { dispose() {} }; },
    executeCommand(id) { log.push('executeCommand:' + id); return Promise.resolve(); }
  },
  window: {
    _terms: [],
    activeTerminal: undefined,
    createTerminal(opts) {
      log.push('createTerminal:' + opts.cwd + ' name=' + (opts.name === undefined ? '<none>' : opts.name));
      const t = makeTerminal(opts);
      this._terms.push(t);
      this.activeTerminal = t;
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
    // Handles both overloads: (msg, options, ...items) and (msg, ...actions).
    showWarningMessage(message, ...rest) {
      const items = rest.length && rest[0] && typeof rest[0] === 'object' && 'modal' in rest[0]
        ? rest.slice(1)
        : rest;
      lastWarningMessage = message;
      lastWarningItems = items;
      log.push('WARN:' + message);
      return Promise.resolve(warningChoice === null ? undefined : items[warningChoice]);
    },
    withProgress(opts, task) {
      log.push('progress:' + opts.title);
      const token = { isCancellationRequested: false };
      if (cancelProgressAfterMs !== null) {
        setTimeout(() => { token.isCancellationRequested = true; }, cancelProgressAfterMs);
      }
      return task({ report() {} }, token);
    },
    registerUriHandler(h) { this._uri = h; return { dispose() {} }; },
    onDidCloseTerminal(fn) { this._onClose = fn; return { dispose() {} }; },
    setStatusBarMessage(m) { log.push('status:' + m); return { dispose() {} }; },
    createWebviewPanel(viewType, title, showOpts, options) {
      const panel = {
        viewType, title, active: true,
        webview: { html: '', onDidReceiveMessage(fn) { this._msg = fn; return { dispose() {} }; } },
        _viewStateFns: [],
        onDidChangeViewState(fn) { this._viewStateFns.push(fn); return { dispose() {} }; },
        _fireViewState(active) { this.active = active; this._viewStateFns.forEach((fn) => fn({ webviewPanel: this })); },
        dispose() { log.push('webview.dispose'); },
        reveal() {}
      };
      log.push('createWebviewPanel:' + viewType);
      lastWebview = panel;
      return panel;
    }
  },
  workspace: {
    getConfiguration(section) {
      if (section === 'ccmHub') {
        return { get: (k, d) => (k in ccmSettings ? ccmSettings[k] : d) };
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

// Shrink the backup poll from minutes to milliseconds.
ext.timing.pollMs = 5;
ext.timing.pickupTimeoutMs = 60;
ext.timing.backupTimeoutMs = 400;

const store = {};
const context = {
  subscriptions: [],
  globalState: { get: (k, d) => (k in store ? store[k] : d), update: (k, v) => { store[k] = v; return Promise.resolve(); } },
  workspaceState: { get: () => false, update: () => Promise.resolve() }
};

const tick = () => new Promise((r) => setTimeout(r, 40));
const at = (ms, fn) => setTimeout(fn, ms);

// Opens a fresh ccm session on `folder` and returns its stub terminal.
async function openVia(folder) {
  quickPickChoice = null;
  vscodeStub.window._uri.handleUri({ query: 'path=' + encodeURIComponent(folder) });
  const term = vscodeStub.window._terms[vscodeStub.window._terms.length - 1];
  vscodeStub.window.activeTerminal = term;
  return term;
}

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
  assert('registers all three commands in commandsToSkipShell', !!upd);
  assert("keeps the user's existing skip-shell entries",
    !!upd && upd.includes('existing.user.command') &&
    upd.includes('ccmHub.openProjectPicker') && upd.includes('ccmHub.closeSession') &&
    upd.includes('ccmHub.copyTerminalSelection'), upd);
  assert('turns confirmOnKill on (VS Code defaults to "editor", which skips panel terminals)',
    settingsStore['terminal.integrated'].confirmOnKill === 'always');
  assert('turns confirmOnExit on (window-close X defaults to "never" and kills every terminal silently)',
    settingsStore['terminal.integrated'].confirmOnExit === 'always');

  log.length = 0;
  ext.activate(context);
  await tick();
  assert('the settings writes are idempotent', !log.some((l) => l.startsWith('settings.update:')));

  settingsStore['terminal.integrated'].confirmOnKill = 'never';
  log.length = 0;
  ext.activate(context);
  await tick();
  assert("an explicit confirmOnKill of the user's is never overwritten",
    settingsStore['terminal.integrated'].confirmOnKill === 'never' &&
    !log.some((l) => l.startsWith('settings.update:confirmOnKill')));

  settingsStore['terminal.integrated'].confirmOnExit = 'never';
  log.length = 0;
  ext.activate(context);
  await tick();
  assert("an explicit confirmOnExit of the user's is never overwritten",
    settingsStore['terminal.integrated'].confirmOnExit === 'never' &&
    !log.some((l) => l.startsWith('settings.update:confirmOnExit')));

  console.log('\npicker');
  log.length = 0;
  quickPickChoice = null;
  await vscodeStub.commands._handlers['ccmHub.openProjectPicker']();
  assert('title carries the build stamp', log.some((l) => l.includes('v17 window-close-guard')));
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
  assert('a fresh session does not resume', !!sent && !sent.includes('--continue'));
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

  // ---- explain-on-selection route -----------------------------------------
  console.log('\nexplain: the floating card');
  const osT = require('os');
  const fsT = require('fs');
  const payloadFile = path.join(osT.tmpdir(), 'ccm_explain_test_' + process.pid + '.json');
  fsT.writeFileSync(payloadFile, JSON.stringify({
    original: 'idempotent <script>x</script>',
    explanation: 'זהו הסבר בעברית פשוטה על המונח.',
    ok: true, model: 'gemini-flash-lite-latest', build: 'test'
  }), 'utf8');

  log.length = 0;
  lastWebview = null;
  vscodeStub.window._uri.handleUri({ path: '/explain', query: 'f=' + encodeURIComponent(payloadFile) });
  assert('the explain route opens a webview, not a terminal',
    !!lastWebview && !log.some((l) => l.startsWith('createTerminal')));
  assert('the explain route deletes the temp payload file after reading it',
    !fsT.existsSync(payloadFile));
  assert('the card renders the Hebrew explanation',
    !!lastWebview && lastWebview.webview.html.includes('זהו הסבר בעברית פשוטה על המונח.'));
  assert('the card is RTL', !!lastWebview && lastWebview.webview.html.includes('dir="rtl"'));
  assert('the card escapes HTML from the selected snippet (no injection)',
    !!lastWebview && lastWebview.webview.html.includes('&lt;script&gt;') &&
    !lastWebview.webview.html.includes('<script>x</script>'));

  // The "click on the terminal" behaviour: losing focus disposes the card.
  log.length = 0;
  lastWebview._fireViewState(false);
  assert('the card closes when focus leaves it (click on the terminal)',
    log.some((l) => l === 'webview.dispose'));

  // A malformed/missing payload must not open a terminal or throw.
  log.length = 0;
  lastWebview = null;
  vscodeStub.window._uri.handleUri({ path: '/explain', query: 'f=' + encodeURIComponent(path.join(osT.tmpdir(), 'ccm_no_such_file.json')) });
  assert('a missing payload file opens nothing and errors quietly',
    !lastWebview && !log.some((l) => l.startsWith('createTerminal')));

  // The route split must not have broken session opening via an explicit /session path.
  log.length = 0;
  vscodeStub.window._uri.handleUri({ path: '/session', query: 'path=' + encodeURIComponent('E:\\MAIN_CLAUDE\\SessionRouteTest') });
  assert('the /session path still opens a terminal',
    log.some((l) => l.startsWith('createTerminal:')));

  // The probe command is a thin wrapper over the built-in terminal copySelection.
  log.length = 0;
  await vscodeStub.commands._handlers['ccmHub.copyTerminalSelection']();
  assert('the probe command copies the terminal selection (never SIGINT)',
    log.some((l) => l === 'executeCommand:workbench.action.terminal.copySelection'));

  // ---- the three-way close -------------------------------------------------
  const closeCmd = vscodeStub.commands._handlers['ccmHub.closeSession'];

  console.log('\nclose: the dialog');
  vscodeStub.window.activeTerminal = undefined;
  log.length = 0;
  warningChoice = null;
  await closeCmd();
  assert('no active terminal closes nothing', !log.some((l) => l.startsWith('dispose:')));

  let t = await openVia('E:\\MAIN_CLAUDE\\CloseDialog');
  log.length = 0;
  warningChoice = null;
  await closeCmd();
  assert('the dialog names the folder it will close',
    /CloseDialog/.test(lastWarningMessage), lastWarningMessage);
  assert('a ccm session is offered all three options',
    lastWarningItems.length === 3 &&
    lastWarningItems[0].title === 'גבה וסגור' &&
    lastWarningItems[1].title === 'סגור' &&
    lastWarningItems[2].title === 'השאר פתוח',
    JSON.stringify(lastWarningItems));
  assert('"keep" is the close affordance, so Esc and the X mean keep',
    lastWarningItems[2].isCloseAffordance === true);
  assert('Esc closes nothing', !log.some((l) => l.startsWith('dispose:')));

  log.length = 0;
  warningChoice = 2; // השאר פתוח
  assert('"keep" closes nothing', (await closeCmd()) === 'keep' && !log.some((l) => l.startsWith('dispose:')));

  log.length = 0;
  warningChoice = 1; // סגור
  assert('"close" closes it', (await closeCmd()) === 'close' && log.some((l) => l.startsWith('dispose:')));

  // A terminal ccm did not open has no Claude session, so no backup to offer.
  const plain = makeTerminal({ cwd: 'E:\\somewhere' });
  plain.name = 'pwsh';
  vscodeStub.window.activeTerminal = plain;
  warningChoice = null;
  await closeCmd();
  assert('a non-ccm terminal is offered close/keep only',
    lastWarningItems.length === 2 && lastWarningItems[0].title === 'סגור',
    JSON.stringify(lastWarningItems));

  console.log('\nclose: backup then close');
  warningChoice = 0; // גבה וסגור

  // Happy path: ✓ (stale) -> ⟳ (claude took the prompt) -> ✓ (and it stays ✓).
  t = await openVia('E:\\MAIN_CLAUDE\\BackupOK');
  t.name = '🟨 ✓ BackupOK';
  log.length = 0;
  cancelProgressAfterMs = null;
  at(10, () => { t.name = '🟨 ⟳ BackupOK'; });
  at(40, () => { t.name = '🟨 ✓ BackupOK'; });
  let outcome = await closeCmd();
  assert('backup runs /session-backup in the session',
    log.some((l) => l === 'sendText:/session-backup'), JSON.stringify(log));
  assert('a finished backup closes the terminal',
    outcome === 'done' && log.some((l) => l.startsWith('dispose:')), outcome);

  // The one that matters: the tab still shows ✓ from BEFORE the backup was sent.
  // Waiting for ✓ would close instantly, with no backup at all.
  t = await openVia('E:\\MAIN_CLAUDE\\StaleTick');
  t.name = '🟨 ✓ StaleTick';
  log.length = 0;
  outcome = await closeCmd();
  assert('a stale ✓ never counts as a finished backup',
    outcome === 'no-pickup' && !log.some((l) => l.startsWith('dispose:')), outcome);

  // Claude asked a question mid-backup.
  t = await openVia('E:\\MAIN_CLAUDE\\NeedsYou');
  t.name = '🟨 ✓ NeedsYou';
  log.length = 0;
  at(10, () => { t.name = '🟨 ⟳ NeedsYou'; });
  at(30, () => { t.name = '🟨 ‼ NeedsYou'; });
  outcome = await closeCmd();
  assert('a session asking for input is left open and focused',
    outcome === 'attention' && !log.some((l) => l.startsWith('dispose:')) && log.some((l) => l.startsWith('show:')),
    outcome);

  // Backup never finishes.
  t = await openVia('E:\\MAIN_CLAUDE\\Forever');
  t.name = '🟨 ✓ Forever';
  log.length = 0;
  at(10, () => { t.name = '🟨 ⟳ Forever'; });
  outcome = await closeCmd();
  assert('a backup that never finishes leaves the terminal open',
    outcome === 'timeout' && !log.some((l) => l.startsWith('dispose:')), outcome);

  // The user cancelled the progress notification.
  t = await openVia('E:\\MAIN_CLAUDE\\Cancelled');
  t.name = '🟨 ✓ Cancelled';
  log.length = 0;
  at(10, () => { t.name = '🟨 ⟳ Cancelled'; });
  cancelProgressAfterMs = 30;
  outcome = await closeCmd();
  cancelProgressAfterMs = null;
  assert('cancelling the backup leaves the terminal open',
    outcome === 'cancelled' && !log.some((l) => l.startsWith('dispose:')), outcome);

  // A single ✓ blip between two tool calls is not the end of the backup.
  t = await openVia('E:\\MAIN_CLAUDE\\Blip');
  t.name = '🟨 ✓ Blip';
  log.length = 0;
  at(10, () => { t.name = '🟨 ⟳ Blip'; });
  at(30, () => { t.name = '🟨 ✓ Blip'; });   // one poll of ✓ ...
  at(36, () => { t.name = '🟨 ⟳ Blip'; });   // ... then back to work
  outcome = await closeCmd();
  assert('a momentary ✓ mid-backup does not close the terminal',
    outcome === 'timeout' && !log.some((l) => l.startsWith('dispose:')), outcome);

  console.log('\nclose: restore after a kill');
  const KILLED = 'E:\\MAIN_CLAUDE\\Killed';
  t = await openVia(KILLED);
  log.length = 0;
  warningChoice = 0; // שחזר את השיחה
  t.exitStatus = { code: 0, reason: vscodeStub.TerminalExitReason.User };
  vscodeStub.window._onClose(t);
  await tick();
  assert('a user-killed session offers a restore', log.some((l) => l.startsWith('WARN:')));
  const resumed = log.find((l) => l.startsWith('sendText:'));
  assert('restoring resumes the conversation with --continue',
    !!resumed && resumed.includes('--continue'), resumed);
  assert('restoring still passes no terminal name',
    log.some((l) => l === 'createTerminal:' + KILLED + ' name=<none>'), JSON.stringify(log));

  for (const reason of ['Shutdown', 'Process', 'Extension']) {
    const q = await openVia('E:\\MAIN_CLAUDE\\Quiet' + reason);
    log.length = 0;
    q.exitStatus = { code: 0, reason: vscodeStub.TerminalExitReason[reason] };
    vscodeStub.window._onClose(q);
    await tick();
    assert(`a ${reason.toLowerCase()} exit offers no restore`, !log.some((l) => l.startsWith('WARN:')), JSON.stringify(log));
  }

  console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
})();
