// ccm-hub  |  BUILD: 2026-07-12 20:45 v15 keycode-dispatch
// Opens a Claude Code session as a NEW integrated terminal in the CURRENT window,
// triggered by a vscode:// URI or by the Alt+O project picker. No SendKeys, no
// focus games — the Terminal API.
//
// URI:  vscode://ccm.hub/session?path=<percent-encoded folder>
// Key:  Alt+O  ->  ccmHub.openProjectPicker
// Key:  Alt+Q  ->  ccmHub.closeSession      (backup / close / keep)
//
// Both keys are LETTER bindings, and VS Code's default `keyboard.dispatch: "code"`
// resolves them by finding the physical key that produces that letter on the ACTIVE
// keyboard layout. With a Hebrew layout active no key produces "o" or "q", so the
// bindings become unresolvable and the keypress falls through to the shell — the
// picker never opens. The installer sets `keyboard.dispatch: "keyCode"` (dispatch by
// hardware key position, layout-independent) so Alt+O/Alt+Q fire under any layout.
// Arrow-key bindings (Alt+Up/Down) never had this problem — they carry no character.
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
// MD -> PDF with correct RTL. A buildless module that renders the Markdown with a
// vendored marked and prints it with the Edge/Chrome already on the machine, so
// there is no npm dependency and no bundled Chromium. See md2pdf/render.js.
const { exportMarkdownToPdf } = require('./md2pdf/render');

// A static icon so a Claude session is distinguishable from a plain shell tab.
const SESSION_ICON = new vscode.ThemeIcon('sparkle');

// Shown in the picker's title bar, so a glance confirms which build is running.
const BUILD = '2026-07-14 22:40 v18 md-rtl-pdf';

const PICKER_COMMAND = 'ccmHub.openProjectPicker';
const CLOSE_COMMAND = 'ccmHub.closeSession';
// Ctrl+Alt+Insert -> copy the terminal selection. The voice service synthesizes this
// keychord to read what the user selected before deciding explain-vs-record; it must be
// in commandsToSkipShell or the terminal would swallow it. copySelection never SIGINTs.
const PROBE_COMMAND = 'ccmHub.copyTerminalSelection';
// Export the active Markdown file to a PDF beside it, with RTL auto-detected from
// the content. Contributed as an editor-title button that only shows for Markdown.
const EXPORT_PDF_COMMAND = 'ccmHub.exportMarkdownPdf';
const SKIP_SHELL_COMMANDS = [PICKER_COMMAND, CLOSE_COMMAND, PROBE_COMMAND];
const MRU_KEY = 'ccmHub.mru';

// The status glyphs the ccm hooks write into the tab title, from
// ~/.claude/skills/session-behavior/scripts/restore-title.sh. Title shape is
// "<model square> <status> <folder>", e.g. "🟨 ⟳ claudeCodeManager".
//
// These reach us because VS Code forwards a terminal's resolved title to the
// extension host — `onAnyInstanceTitleChange(i => $acceptTerminalTitleChange(
// i.instanceId, i.title))` — where it lands as `Terminal.name`. So `term.name`
// is a live read of what the hooks last said about that session.
const GLYPH_WORKING = '⟳';
const GLYPH_DONE = '✓';
const GLYPH_ATTENTION = '‼';

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

function folderOf(term) {
  for (const [folder, t] of sessions) {
    if (t === term) return folder;
  }
  return undefined;
}

function openSession(folder, opts = {}) {
  if (!folder) {
    vscode.window.showErrorMessage('ccm-hub: no folder path was provided.');
    return undefined;
  }

  const existing = sessions.get(folder);
  if (existing) {
    existing.show();
    return existing;
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
  let claudeCmd = cfg().get('claudeCommand') || 'claude --dangerously-skip-permissions';
  // `--continue` reopens the conversation Claude persisted to
  // ~/.claude/projects/<encoded cwd>/*.jsonl, so a killed session is not a lost one.
  if (opts.resume) claudeCmd += ' --continue';
  term.sendText(`${osc}; ${claudeCmd}`);
  return term;
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

// ---------------------------------------------------------------------------
// Closing a session
// ---------------------------------------------------------------------------
//
// There is NO cancellable "terminal is about to close" event. The extension API
// exposes `onDidCloseTerminal` and nothing else — `onWillCloseTerminal` does not
// exist anywhere in the 1.128 extension host. So an extension cannot make the
// trash icon ask its own question. Two mechanisms cover the gap:
//
//   1. `terminal.integrated.confirmOnKill` — VS Code's own pre-close guard. Every
//      built-in kill path (trash icon, middle-click on the tab, Kill Terminal,
//      Kill All) funnels through `safeDisposeTerminal`, which is gated on it:
//        if (target !== editor && hasChildProcesses &&
//            (confirmOnKill === "panel" || confirmOnKill === "always") &&
//            await this._showTerminalCloseConfirmation(true)) return;   // cancelled
//      Its dialog only offers Terminate/Cancel, so it buys "close vs keep", not
//      "backup". Note `hasChildProcesses`: a terminal sitting idle at a bare
//      prompt has none, and closes without a word. That is what (2) is for.
//
//   2. `ccmHub.closeSession` (Alt+Q, terminal context menus) — our own close,
//      which asks all three questions before anything is destroyed.
//
// And `onDidCloseTerminal` adds an undo: a session killed by the user is offered
// back with `claude --continue`.

const BACKUP_CMD = '/session-backup';

// A test seam: test-extension.js shrinks these so the backup poll runs in
// milliseconds instead of minutes. Nothing else may write to it.
const timing = {
  pollMs: 1000,
  // The UserPromptSubmit hook writes ⟳ the moment a prompt is submitted, and it
  // is NOT debounced (only "working" from PostToolUse is). It still travels
  // through a ~500ms PowerShell SetConsoleTitle, so allow slack before giving up.
  pickupTimeoutMs: 45 * 1000,
  backupTimeoutMs: 20 * 60 * 1000,
  // ✓ has to hold still. The Stop hook can fire between two tool calls mid-backup,
  // so a single ✓ reading is not "finished" — three consecutive polls of it are.
  settlePolls: 3
};

// Polls `term.name` until `test` returns a verdict, the terminal dies, the user
// cancels, or the deadline passes (null). Never resolves to a verdict `test`
// did not produce — every ambiguous ending must keep the terminal alive.
function waitForTitle(term, token, timeoutMs, test) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (token && token.isCancellationRequested) return resolve('cancelled');
      if (term.exitStatus !== undefined) return resolve('gone');
      const verdict = test(term.name || '');
      if (verdict) return resolve(verdict);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, timing.pollMs);
    };
    tick();
  });
}

// Runs /session-backup in the session and closes the terminal only once the
// hooks report the session is idle again.
//
// THE INVARIANT: this function closes the terminal on exactly one outcome —
// `done`. Timeout, cancellation, a question from Claude, an unresponsive
// session: all leave the terminal open. The whole feature exists to stop a
// terminal dying by surprise, so a bug here must fail in the direction of a
// terminal that stays open, never one that vanishes mid-backup.
async function backupThenClose(term, label) {
  term.show();
  term.sendText(BACKUP_CMD);

  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `ccm: מגבה את «${label}» לפני הסגירה…`,
      cancellable: true
    },
    async (_progress, token) => {
      // Phase 1 — did Claude take the prompt? A stale ✓ from before the send is
      // still on the tab right now, so waiting for ✓ here would close instantly.
      // Wait for ⟳ instead: proof the prompt was submitted and work has begun.
      const pickup = await waitForTitle(term, token, timing.pickupTimeoutMs, (name) => {
        if (name.includes(GLYPH_ATTENTION)) return 'attention';
        if (name.includes(GLYPH_WORKING)) return 'working';
        return null;
      });
      if (pickup !== 'working') return pickup || 'no-pickup';

      // Phase 2 — wait for the backup to land and stay landed.
      let settled = 0;
      const finish = await waitForTitle(term, token, timing.backupTimeoutMs, (name) => {
        if (name.includes(GLYPH_ATTENTION)) return 'attention';
        if (name.includes(GLYPH_DONE)) {
          settled += 1;
          return settled >= timing.settlePolls ? 'done' : null;
        }
        settled = 0;
        return null;
      });
      return finish || 'timeout';
    }
  );

  switch (outcome) {
    case 'done':
      term.dispose();
      vscode.window.showInformationMessage(`ccm: «${label}» גובה ונסגר.`);
      break;
    case 'attention':
      term.show();
      vscode.window.showWarningMessage(
        `ccm: «${label}» מחכה לתשובה ממך. הטרמינל נשאר פתוח.`
      );
      break;
    case 'cancelled':
      vscode.window.showInformationMessage(`ccm: הגיבוי בוטל. «${label}» נשאר פתוח.`);
      break;
    case 'gone':
      break; // the terminal died on its own; nothing left to close or say
    case 'no-pickup':
      vscode.window.showWarningMessage(
        `ccm: אין תגובה מ-claude ב-«${label}». הטרמינל נשאר פתוח — גבה ידנית וסגור.`
      );
      break;
    default:
      vscode.window.showWarningMessage(
        `ccm: הגיבוי של «${label}» לא הסתיים בזמן. הטרמינל נשאר פתוח.`
      );
  }
  return outcome;
}

// The three-way close. The dialog NAMES the folder it is about to close: the
// terminal-tab context menu acts on the active terminal, so if a right-click on
// a background tab ever fails to activate it, the user reads the wrong name and
// presses "keep" instead of silently losing the wrong session.
async function closeSession() {
  const term = vscode.window.activeTerminal;
  if (!term) {
    vscode.window.showInformationMessage('ccm: אין טרמינל פעיל לסגור.');
    return undefined;
  }

  const folder = folderOf(term);
  const label = folder ? path.basename(folder) : term.name || 'terminal';

  const BACKUP = { title: 'גבה וסגור' };
  const CLOSE = { title: 'סגור' };
  const KEEP = { title: 'השאר פתוח', isCloseAffordance: true };
  const buttons = folder ? [BACKUP, CLOSE, KEEP] : [CLOSE, KEEP];

  const pick = await vscode.window.showWarningMessage(
    `לסגור את «${label}»?`,
    {
      modal: true,
      detail: folder
        ? 'גיבוי מריץ /session-backup בסשן, מחכה שיסתיים, ורק אז סוגר.'
        : 'הטרמינל הזה לא נפתח על ידי ccm, ולכן אין בו סשן לגבות.'
    },
    ...buttons
  );

  // Esc, the X, and the close-affordance button all mean the same thing.
  if (!pick || pick === KEEP) return 'keep';
  if (pick === CLOSE) {
    term.dispose();
    return 'close';
  }
  return backupThenClose(term, label);
}

// A ccm session the user killed. `TerminalExitReason.User` (3) is the deliberate
// paths only — the trash icon, Kill Terminal, middle-click. `Process` (2) means
// claude or the shell exited on its own, `Shutdown` (1) means VS Code is closing,
// and `Extension` (4) is our own dispose() above. None of those want an undo.
function offerRestore(term, folder) {
  if (!cfg().get('guardTerminalClose', true)) return;
  const User = (vscode.TerminalExitReason && vscode.TerminalExitReason.User) || 3;
  if (!term.exitStatus || term.exitStatus.reason !== User) return;

  const label = path.basename(folder);
  vscode.window
    .showWarningMessage(`ccm: הסשן «${label}» נסגר.`, 'שחזר את השיחה')
    .then((pick) => {
      if (pick) openSession(folder, { resume: true });
    });
}

// A keybinding pressed while a TERMINAL has focus is forwarded to the shell unless
// its command sits in `terminal.integrated.commandsToSkipShell`. Our commands are
// custom ids, so they are not in VS Code's 159-entry default list, and Alt+O /
// Alt+Q would be swallowed by PowerShell — the picker would simply never appear.
// Verified in the 1.128 bundle: `let t = new Set(defaults); ...; t.add(r)` — the
// user's array is MERGED into the defaults (a `-` prefix removes), so appending
// ids is safe and destroys nothing.
//
// We do this from code rather than from the installer's settings merge, because
// the installer overwrites a key wholesale and would drop any ids the user added.
async function ensureSkipShell() {
  const conf = vscode.workspace.getConfiguration('terminal.integrated');
  const info = conf.inspect('commandsToSkipShell');
  const current = (info && info.globalValue) || [];
  const missing = SKIP_SHELL_COMMANDS.filter(
    (id) => !current.includes(id) && !current.includes(`-${id}`)
  );
  if (!missing.length) return;
  try {
    await conf.update(
      'commandsToSkipShell',
      [...current, ...missing],
      vscode.ConfigurationTarget.Global
    );
  } catch {
    /* read-only settings.json — the commands still work from the Command Palette */
  }
}

// VS Code's default is "editor", which confirms only for terminals opened in the
// editor area — a panel terminal, which is every terminal ccm opens, is killed by
// one click with no warning. "always" covers both. If the user has an explicit
// opinion in their settings we leave it alone; this only fills an empty slot.
async function ensureConfirmOnKill() {
  if (!cfg().get('guardTerminalClose', true)) return;
  const conf = vscode.workspace.getConfiguration('terminal.integrated');
  const info = conf.inspect('confirmOnKill');
  if (info && info.globalValue !== undefined) return;
  try {
    await conf.update('confirmOnKill', 'always', vscode.ConfigurationTarget.Global);
  } catch {
    /* read-only settings.json — Alt+Q still asks */
  }
}

// `confirmOnKill` guards ONE terminal (the trash icon, Kill Terminal). It does
// NOTHING when the whole window closes — click the window's X and VS Code takes
// every terminal down with it, silently. The window-close path has its own
// setting: `confirmOnExit`, whose default is "never". "always" makes the X ask
// first (its built-in dialog even names the count of live terminals), which is
// the whole point: stop an accidental window close from killing live sessions.
// An extension cannot intercept the window X itself — there is no cancellable
// close event — so this built-in setting is the only lever. Fill it only when
// the user has no opinion of their own, exactly like confirmOnKill above.
async function ensureConfirmOnExit() {
  if (!cfg().get('guardTerminalClose', true)) return;
  const conf = vscode.workspace.getConfiguration('terminal.integrated');
  const info = conf.inspect('confirmOnExit');
  if (info && info.globalValue !== undefined) return;
  try {
    await conf.update('confirmOnExit', 'always', vscode.ConfigurationTarget.Global);
  } catch {
    /* read-only settings.json — nothing else covers the window-close X */
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

// ---------------------------------------------------------------------------
// Explain a terminal selection in plain Hebrew
// ---------------------------------------------------------------------------
//
// The voice service (which owns Right Ctrl) detects a terminal selection, asks a
// cheap model for a plain-Hebrew explanation, writes {original, explanation, ...} to
// a temp JSON file, and fires `vscode://ccm.hub/explain?f=<file>`. We read the file,
// render a floating RTL card, and delete the file. A file — not URI query args —
// carries long Hebrew text without length or encoding trouble.
//
// The card is technically an editor-area webview (VS Code exposes no true floating
// window to extensions), but it takes focus, closes on Esc and its ✕ button, and
// closes the moment focus leaves it (a click on the terminal) — so it behaves like
// the floating card the user asked for. The explanation is rendered in a real RTL
// container, which is the reversed-Hebrew problem finally solved on the output side.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function explainHtml(payload) {
  const original = escapeHtml(payload.original || '');
  const explanation = escapeHtml(payload.explanation || '');
  const ok = payload.ok !== false;
  const meta = escapeHtml(`${payload.model || ''} · ccm ${payload.build || ''}`);
  const answerClass = ok ? 'answer' : 'answer error';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 18px 20px 16px;
    font-family: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    direction: rtl;
  }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .title { font-size: 15px; font-weight: 600; flex: 1; }
  .close {
    all: unset; cursor: pointer; font-size: 18px; line-height: 1;
    padding: 2px 8px; border-radius: 6px; opacity: .7;
  }
  .close:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
  .answer {
    font-size: 15px; line-height: 1.75; white-space: pre-wrap; word-break: break-word;
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.08));
    border-right: 3px solid var(--vscode-focusBorder, #007acc);
    border-radius: 8px; padding: 14px 16px;
  }
  .answer.error { border-right-color: var(--vscode-errorForeground, #e5484d); }
  .snip-wrap { margin-top: 14px; }
  .snip-label {
    font-size: 12px; opacity: .7; margin-bottom: 6px; cursor: pointer; user-select: none;
  }
  .snip {
    direction: ltr; text-align: left; unicode-bidi: plaintext;
    font-family: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    max-height: 160px; overflow: auto;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12));
    border-radius: 6px; padding: 10px 12px; margin: 0;
  }
  .snip.hidden { display: none; }
  .foot {
    display: flex; align-items: center; gap: 12px; margin-top: 14px;
    font-size: 11.5px; opacity: .6;
  }
  .foot .spacer { flex: 1; }
  .btn {
    all: unset; cursor: pointer; font-size: 12px; padding: 4px 10px; border-radius: 6px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
    color: var(--vscode-button-secondaryForeground, inherit);
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
</style>
</head>
<body>
  <div class="head">
    <div class="title">🧠 הסבר</div>
    <button class="close" id="close" title="סגור (Esc)">✕</button>
  </div>
  <div class="${answerClass}" id="answer">${explanation}</div>
  <div class="snip-wrap">
    <div class="snip-label" id="toggle">▸ הטקסט שסימנת</div>
    <pre class="snip hidden" id="snip">${original}</pre>
  </div>
  <div class="foot">
    <button class="btn" id="copy">העתק הסבר</button>
    <span class="spacer"></span>
    <span>Esc או לחיצה על הטרמינל לסגירה · ${meta}</span>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
  const snip = document.getElementById('snip');
  const toggle = document.getElementById('toggle');
  toggle.addEventListener('click', () => {
    const hidden = snip.classList.toggle('hidden');
    toggle.textContent = (hidden ? '▸' : '▾') + ' הטקסט שסימנת';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') vscode.postMessage({ type: 'close' }); });
  window.focus();
</script>
</body>
</html>`;
}

function showExplanation(payload) {
  const panel = vscode.window.createWebviewPanel(
    'ccmExplain',
    '🧠 הסבר',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: false }
  );
  panel.webview.html = explainHtml(payload || {});

  panel.webview.onDidReceiveMessage((m) => {
    if (!m) return;
    if (m.type === 'close') panel.dispose();
    if (m.type === 'copy') {
      vscode.env.clipboard.writeText(String(payload.explanation || ''));
      vscode.window.setStatusBarMessage('ccm: ההסבר הועתק', 2000);
    }
  });

  // Close on blur — the moment focus leaves the card (e.g. a click back on the
  // terminal), it disposes. That is the "floating card that closes when I click
  // away" behaviour. The first state change is active=true (the panel taking focus),
  // which does not dispose.
  panel.onDidChangeViewState((e) => {
    if (!e.webviewPanel.active) panel.dispose();
  });
}

function handleExplainUri(uri) {
  const params = new URLSearchParams(uri.query || '');
  const f = params.get('f');
  if (!f) return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    vscode.window.showErrorMessage('ccm: could not read explanation payload — ' + err.message);
  }
  try { fs.unlinkSync(f); } catch { /* best effort */ }
  if (payload) showExplanation(payload);
}

// ---------------------------------------------------------------------------
// Export the active Markdown to a PDF, with RTL that the VS Code preview and the
// editor itself cannot give. VS Code has no API to flip a text editor to RTL (a
// years-open feature request), and the built-in preview has no export at all — so
// a Hebrew .md had no route to a correctly right-aligned PDF. This does it: render
// with marked, print with the installed browser, direction auto-detected. `arg`
// may be a Uri when the command is fired from the editor-title button.
async function exportMarkdownPdf(arg) {
  // Resolve which Markdown file to export: the button passes the tab's Uri; the
  // Command Palette passes nothing, so fall back to the active editor.
  let doc;
  if (arg && arg.fsPath) {
    doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === arg.fsPath);
    if (!doc) {
      try { doc = await vscode.workspace.openTextDocument(arg); } catch { /* ignore */ }
    }
  }
  if (!doc) {
    const ed = vscode.window.activeTextEditor;
    if (ed) doc = ed.document;
  }
  if (!doc) {
    vscode.window.showInformationMessage('ccm: פתח קובץ Markdown כדי לייצא ל-PDF.');
    return;
  }

  const isMd =
    doc.languageId === 'markdown' || /\.(md|markdown)$/i.test(doc.uri.fsPath || '');
  if (!isMd) {
    vscode.window.showInformationMessage('ccm: הקובץ הפעיל אינו Markdown.');
    return;
  }

  // The base href and relative images need the document's real folder, so an
  // untitled buffer has nowhere to resolve against — ask the user to save first.
  if (doc.isUntitled) {
    vscode.window.showWarningMessage('ccm: שמור את הקובץ (Ctrl+S) לפני ייצוא ל-PDF.');
    return;
  }
  // Export what is on screen, not the last save.
  if (doc.isDirty) { await doc.save(); }

  const mdPath = doc.uri.fsPath;
  const pdfPath = mdPath.replace(/\.(md|markdown)$/i, '') + '.pdf';

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `ccm: מייצא «${path.basename(mdPath)}» ל-PDF…`,
      cancellable: false
    },
    async () => {
      try {
        const { dir } = await exportMarkdownToPdf({ mdPath, pdfPath });
        const arabicOrHebrew = dir === 'rtl' ? 'RTL' : 'LTR';
        const OPEN = 'פתח PDF';
        const REVEAL = 'הצג בתיקייה';
        const pick = await vscode.window.showInformationMessage(
          `ccm: נוצר PDF (${arabicOrHebrew}) — ${path.basename(pdfPath)}`,
          OPEN,
          REVEAL
        );
        if (pick === OPEN) vscode.env.openExternal(vscode.Uri.file(pdfPath));
        if (pick === REVEAL) {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pdfPath));
        }
      } catch (err) {
        vscode.window.showErrorMessage('ccm: ייצוא ל-PDF נכשל — ' + (err && err.message));
      }
    }
  );
}

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
  ensureConfirmOnKill();
  ensureConfirmOnExit();

  // A terminal the user killed is not a session any more — but it is still
  // recoverable, so offer that before forgetting it.
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      const folder = folderOf(t);
      if (folder === undefined) return;
      sessions.delete(folder);
      offerRestore(t, folder);
    })
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        // Route by path: `/explain` shows a Hebrew explanation card, everything else
        // (incl. `/session` and the legacy no-path form) opens a session.
        const route = (uri.path || '').replace(/^\/+/, '');
        if (route === 'explain') return handleExplainUri(uri);
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
    vscode.commands.registerCommand(CLOSE_COMMAND, () => closeSession())
  );

  // The probe: copy the terminal selection so the voice service can read it. A thin
  // wrapper over the built-in so we own its keybinding, when-clause and skip-shell entry.
  context.subscriptions.push(
    vscode.commands.registerCommand(PROBE_COMMAND, () =>
      vscode.commands.executeCommand('workbench.action.terminal.copySelection')
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EXPORT_PDF_COMMAND, (arg) => exportMarkdownPdf(arg))
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

module.exports = { activate, deactivate, timing };
