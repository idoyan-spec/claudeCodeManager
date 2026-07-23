/* ccm-hub / browser/webview.js
 *
 * The client half of the Alt+E file browser. It owns the two panes, the
 * keyboard model, the context menu and the little in-panel dialogs; it owns no
 * filesystem knowledge at all. Every listing, every action and even the
 * clipboard round-trips to the extension host over postMessage, because a
 * webview is a sandboxed iframe with no disk and no VS Code API.
 *
 * WHY THE DIALOGS ARE DRAWN HERE instead of using showInputBox /
 * showWarningMessage: the panel closes the moment it loses focus (that is the
 * "closes when you touch somewhere else" behaviour that was asked for), and a
 * native VS Code dialog takes focus away from the webview. Renaming a file
 * through showInputBox would therefore kill the browser mid-rename. Drawing the
 * prompt inside the webview keeps focus where it is and the browser alive.
 */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const el = {
    backdrop: $('backdrop'), card: $('card'),
    back: $('back'), fwd: $('fwd'), up: $('up'),
    crumbs: $('crumbs'), filter: $('filter'), hidden: $('hidden'), close: $('close'),
    tree: $('tree'), list: $('list'), split: $('split'),
    status: $('status'), build: $('build'),
    menu: $('menu'), submenu: $('submenu'),
    dialogwrap: $('dialogwrap'), dialog: $('dialog')
  };

  const S = {
    build: '',
    sep: '\\',
    roots: [],
    agents: [],
    enterRuns: false,
    showHidden: false,
    // path -> { path, name, depth, expanded, children (null = not loaded), empty }
    nodes: new Map(),
    order: [],          // the tree rows currently visible, top to bottom
    treeSel: '',
    cur: '',            // the folder the right pane is showing
    curParent: '',
    entries: [],        // everything in `cur`
    view: [],           // `entries` after the filter box
    listSel: -1,
    pane: 'tree',
    hist: [],
    hpos: -1,
    revealTarget: null, // a path the tree is still walking down to
    selectAfter: null,  // a name to land on once the next listing arrives
    menu: null,
    dialog: null,
    typed: '',
    typedAt: 0
  };

  const GLYPH = {
    folder: '📁', code: '🧩', script: '⚡', binary: '⚙', doc: '📄',
    data: '🗂', image: '🖼', media: '🎵', archive: '🗜', file: '▫'
  };

  /* ------------------------------------------------------------- helpers */

  function post(msg) { vscode.postMessage(msg); }

  function baseName(p) {
    const parts = String(p).split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  }

  function isUnder(parent, child) {
    return child === parent || child.startsWith(parent.endsWith(S.sep) ? parent : parent + S.sep);
  }

  function rootOf(p) {
    // The longest root that contains `p`, so nested roots resolve to the closest.
    let best = '';
    for (const r of S.roots) {
      if (isUnder(r.path, p) && r.path.length > best.length) best = r.path;
    }
    return best;
  }

  function chainOf(root, target) {
    const chain = [root];
    if (target === root) return chain;
    const rest = target.slice(root.endsWith(S.sep) ? root.length : root.length + 1);
    let cur = root.endsWith(S.sep) ? root.slice(0, -1) : root;
    for (const part of rest.split(/[\\/]/).filter(Boolean)) {
      cur = cur + S.sep + part;
      chain.push(cur);
    }
    return chain;
  }

  function fmtWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  function setStatus(text) { el.status.textContent = text || ''; }

  /* --------------------------------------------------------------- tree */

  function ensureNode(path, name, depth) {
    let n = S.nodes.get(path);
    if (!n) {
      n = { path, name: name || baseName(path), depth, expanded: false, children: null, empty: false };
      S.nodes.set(path, n);
    }
    if (typeof depth === 'number') n.depth = depth;
    return n;
  }

  function rebuildOrder() {
    S.order = [];
    const walk = (path) => {
      const n = S.nodes.get(path);
      if (!n) return;
      S.order.push(path);
      if (n.expanded && n.children) n.children.forEach(walk);
    };
    S.roots.forEach((r) => walk(r.path));
  }

  function requestKids(path) {
    post({ type: 'kids', path, showHidden: S.showHidden });
  }

  function toggleNode(path, want) {
    const n = S.nodes.get(path);
    if (!n) return;
    const next = want === undefined ? !n.expanded : want;
    n.expanded = next;
    if (next && !n.children) requestKids(path);
    rebuildOrder();
    renderTree();
  }

  // Walk the tree down to `S.revealTarget`, one loaded level at a time. Called
  // again from the `kids` handler, so an unloaded level pauses the walk instead
  // of aborting it.
  function stepReveal() {
    const target = S.revealTarget;
    if (!target) return;
    const root = rootOf(target);
    if (!root) { S.revealTarget = null; S.treeSel = ''; rebuildOrder(); renderTree(); return; }

    const chain = chainOf(root, target);
    for (let i = 0; i < chain.length; i += 1) {
      const p = chain[i];
      const n = ensureNode(p, undefined, i);
      if (p === target) {
        S.treeSel = target;
        S.revealTarget = null;
        rebuildOrder();
        renderTree();
        scrollIntoPane(el.tree, `tr-${S.order.indexOf(target)}`);
        return;
      }
      n.expanded = true;
      if (!n.children) {
        requestKids(p);
        rebuildOrder();
        renderTree();
        return; // resumes when the children land
      }
    }
    S.revealTarget = null;
  }

  function renderTree() {
    const frag = document.createDocumentFragment();
    S.order.forEach((path, i) => {
      const n = S.nodes.get(path);
      const row = document.createElement('div');
      row.className = 'row' + (path === S.treeSel ? ' sel cursor' : '');
      row.id = `tr-${i}`;
      row.dataset.path = path;
      row.style.paddingLeft = `${8 + n.depth * 14}px`;

      const tw = document.createElement('span');
      tw.className = 'twisty' + (n.empty ? ' empty' : '') + (n.expanded ? ' open' : '');
      tw.textContent = '▶';
      tw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); toggleNode(path); });
      row.appendChild(tw);

      const g = document.createElement('span');
      g.className = 'glyph';
      g.textContent = GLYPH.folder;
      row.appendChild(g);

      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = n.name;
      row.appendChild(nm);

      row.addEventListener('mousedown', (e) => {
        if (e.button === 2) return;
        S.pane = 'tree';
        el.tree.focus();
        S.treeSel = path;
        renderTree();
        openDir(path, { keepPane: true });
      });
      row.addEventListener('dblclick', () => toggleNode(path));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.pane = 'tree';
        el.tree.focus();
        S.treeSel = path;
        renderTree();
        openMenu(e.clientX, e.clientY, { path, dir: true, name: n.name });
      });

      frag.appendChild(row);
    });
    el.tree.replaceChildren(frag);
  }

  /* --------------------------------------------------------------- list */

  function applyFilter() {
    const q = el.filter.value.trim().toLowerCase();
    S.view = q ? S.entries.filter((e) => e.name.toLowerCase().includes(q)) : S.entries.slice();
    if (S.listSel >= S.view.length) S.listSel = S.view.length - 1;
    if (S.listSel < 0 && S.view.length) S.listSel = 0;
  }

  function renderList() {
    if (!S.view.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = S.entries.length ? 'אין פריט שתואם לסינון.' : 'התיקייה ריקה.';
      el.list.replaceChildren(note);
      return;
    }

    const frag = document.createDocumentFragment();
    S.view.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (i === S.listSel ? ' sel cursor' : '') + (e.link ? ' link' : '');
      row.id = `ls-${i}`;

      const g = document.createElement('span');
      g.className = 'glyph';
      g.textContent = GLYPH[e.kind] || GLYPH.file;
      row.appendChild(g);

      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = e.name;
      row.appendChild(nm);

      if (e.runnable) {
        const run = document.createElement('button');
        run.className = 'run';
        run.textContent = '▶';
        run.title = 'הרץ (F5)';
        run.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          act({ act: 'run', path: e.path });
        });
        row.appendChild(run);
      }

      const size = document.createElement('span');
      size.className = 'meta size';
      size.textContent = e.dir ? '' : fmtSize(e.size);
      row.appendChild(size);

      const when = document.createElement('span');
      when.className = 'meta when';
      when.textContent = fmtWhen(e.mtime);
      row.appendChild(when);

      row.addEventListener('mousedown', (ev) => {
        if (ev.button === 2) return;
        S.pane = 'list';
        el.list.focus();
        S.listSel = i;
        renderList();
      });
      row.addEventListener('dblclick', () => activate(e));
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        S.pane = 'list';
        el.list.focus();
        S.listSel = i;
        renderList();
        openMenu(ev.clientX, ev.clientY, e);
      });

      frag.appendChild(row);
    });
    el.list.replaceChildren(frag);
  }

  function renderCrumbs() {
    const frag = document.createDocumentFragment();
    if (!S.cur) { el.crumbs.replaceChildren(frag); return; }

    const root = rootOf(S.cur) || S.cur;
    const chain = chainOf(root, S.cur);
    // A deep path would push the filter box off the bar, so keep the tail.
    const shown = chain.length > 6 ? chain.slice(chain.length - 6) : chain;
    if (shown.length < chain.length) {
      const dots = document.createElement('span');
      dots.className = 'crumbsep';
      dots.textContent = '…';
      frag.appendChild(dots);
    }
    shown.forEach((p, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'crumbsep';
        sep.textContent = '›';
        frag.appendChild(sep);
      }
      const b = document.createElement('button');
      b.className = 'crumb' + (i === shown.length - 1 ? ' last' : '');
      b.textContent = p === root ? (S.roots.find((r) => r.path === root) || {}).name || baseName(p) : baseName(p);
      b.title = p;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); openDir(p); });
      frag.appendChild(b);
    });
    el.crumbs.replaceChildren(frag);
  }

  function renderNav() {
    el.back.disabled = S.hpos <= 0;
    el.fwd.disabled = S.hpos < 0 || S.hpos >= S.hist.length - 1;
    el.up.disabled = !S.curParent;
    el.hidden.classList.toggle('on', S.showHidden);
  }

  function scrollIntoPane(pane, id) {
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  /* -------------------------------------------------------- navigation */

  function openDir(path, opts = {}) {
    if (!path) return;
    if (!opts.noHistory) {
      if (S.hist[S.hpos] !== path) {
        S.hist = S.hist.slice(0, S.hpos + 1);
        S.hist.push(path);
        S.hpos = S.hist.length - 1;
      }
    }
    if (opts.selectAfter) S.selectAfter = opts.selectAfter;
    if (opts.focusList) S.pane = 'list';
    post({ type: 'dir', path, showHidden: S.showHidden });
  }

  function goUp() {
    if (!S.curParent) return;
    const leaving = baseName(S.cur);
    openDir(S.curParent, { selectAfter: leaving });
  }

  function goBack() {
    if (S.hpos <= 0) return;
    S.hpos -= 1;
    openDir(S.hist[S.hpos], { noHistory: true });
  }

  function goFwd() {
    if (S.hpos >= S.hist.length - 1) return;
    S.hpos += 1;
    openDir(S.hist[S.hpos], { noHistory: true });
  }

  // Enter / double-click. A folder is entered; a file is opened in the editor,
  // unless `ccmHub.browser.enterRuns` flipped Enter into a run.
  function activate(entry) {
    if (!entry) return;
    if (entry.dir) { openDir(entry.path, { focusList: true }); return; }
    if (S.enterRuns && entry.runnable) act({ act: 'run', path: entry.path });
    else act({ act: 'open', path: entry.path });
  }

  function selected() {
    if (S.pane === 'tree') {
      const n = S.nodes.get(S.treeSel);
      return n ? { path: n.path, name: n.name, dir: true, runnable: false } : null;
    }
    return S.view[S.listSel] || null;
  }

  // The folder an action without a target should apply to: whatever the right
  // pane is showing.
  function currentDir() {
    return S.cur;
  }

  function act(payload) {
    post({ type: 'act', showHidden: S.showHidden, ...payload });
  }

  /* ------------------------------------------------------- context menu */

  function agentItems() {
    return S.agents.map((a) => ({
      id: `agent:${a.id}`,
      label: a.label,
      glyph: a.glyph,
      key: a.installed ? '' : 'לא מותקן',
      off: !a.installed
    }));
  }

  function menuItems(target) {
    const isDir = !!target && target.dir;
    const items = [];

    if (target) {
      items.push({ id: 'open', label: isDir ? 'פתח תיקייה' : 'פתח בעורך', glyph: isDir ? '📂' : '📄', key: 'Enter' });
      if (!isDir) {
        items.push({
          id: 'run',
          label: target.runnable ? 'הרץ' : 'הרץ (אין מריץ מוכר)',
          glyph: '▶',
          key: 'F5',
          off: !target.runnable
        });
        items.push({ id: 'external', label: 'פתח בתוכנת ברירת המחדל', glyph: '🚀' });
        if (/\.(md|markdown)$/i.test(target.name)) {
          items.push({ id: 'pdf', label: 'ייצא ל-PDF (RTL)', glyph: '🧾' });
        }
      }
      items.push({ sep: true });
    }

    items.push({ title: isDir || !target ? 'טרמינל בתיקייה זו' : 'טרמינל בתיקייה של הקובץ' });
    items.push({ id: 'agents', label: 'סוכן AI', glyph: '🤖', sub: 'agents' });
    items.push({ id: 'shell', label: 'טרמינל רגיל', glyph: '❯', key: 'Ctrl+`' });
    items.push({ sep: true });

    if (isDir) {
      items.push({ id: 'window', label: 'פתח כפרויקט בחלון חדש', glyph: '🪟' });
    }
    items.push({ id: 'reveal', label: 'הצג בסייר Windows', glyph: '🗂' });
    items.push({ id: 'copyPath', label: 'העתק נתיב מלא', glyph: '📋' });
    items.push({ id: 'copyName', label: 'העתק שם', glyph: '🏷' });
    items.push({ sep: true });
    items.push({ id: 'newFile', label: 'קובץ חדש', glyph: '✚' });
    items.push({ id: 'newFolder', label: 'תיקייה חדשה', glyph: '📁' });
    if (target) {
      items.push({ id: 'rename', label: 'שנה שם', glyph: '✎', key: 'F2' });
      items.push({ id: 'delete', label: 'מחק', glyph: '🗑', key: 'Del', danger: true });
    }
    items.push({ sep: true });
    items.push({ id: 'refresh', label: 'רענן', glyph: '⟳', key: 'F5 / Ctrl+R' });

    return items;
  }

  function drawMenu(node, items, sel) {
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      if (it.sep) {
        const d = document.createElement('div');
        d.className = 'msep';
        frag.appendChild(d);
        return;
      }
      if (it.title) {
        const t = document.createElement('div');
        t.className = 'mtitle';
        t.textContent = it.title;
        frag.appendChild(t);
        return;
      }
      const d = document.createElement('div');
      d.className = 'mi' + (i === sel ? ' on' : '') + (it.danger ? ' danger' : '') + (it.off ? ' off' : '');
      d.dataset.index = String(i);

      const g = document.createElement('span');
      g.className = 'mglyph';
      g.textContent = it.glyph || '';
      d.appendChild(g);

      const l = document.createElement('span');
      l.className = 'mlabel';
      l.textContent = it.label;
      d.appendChild(l);

      if (it.sub) {
        const a = document.createElement('span');
        a.className = 'marrow';
        a.textContent = '◀';
        d.appendChild(a);
      } else if (it.key) {
        const k = document.createElement('span');
        k.className = 'mkey';
        k.textContent = it.key;
        d.appendChild(k);
      }

      d.addEventListener('mouseenter', () => {
        if (node === el.menu) { S.menu.sel = i; paintMenu(); if (!it.sub) closeSubmenu(); }
        else { S.menu.subSel = i; paintMenu(); }
      });
      // LEFT button only. On Windows `contextmenu` fires between mousedown and
      // mouseup of the RIGHT button, so a plain mouseup handler would fire the
      // item that happens to sit under the cursor the instant the menu appears.
      d.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        chooseIndex(node === el.submenu, i);
      });
      frag.appendChild(d);
    });
    node.replaceChildren(frag);
  }

  function paintMenu() {
    if (!S.menu) return;
    drawMenu(el.menu, S.menu.items, S.menu.sel);
    if (S.menu.subItems) drawMenu(el.submenu, S.menu.subItems, S.menu.inSub ? S.menu.subSel : -1);
  }

  function firstSelectable(items, from, dir) {
    let i = from;
    for (let n = 0; n < items.length; n += 1) {
      i = (i + dir + items.length) % items.length;
      if (!items[i].sep && !items[i].title) return i;
    }
    return from;
  }

  function openMenu(x, y, target) {
    closeMenu();
    const items = menuItems(target);
    S.menu = { items, sel: firstSelectable(items, -1, 1), target, x, y, inSub: false, subItems: null, subSel: 0 };
    el.menu.hidden = false;
    paintMenu();
    // Position after it has a size, then clamp so it never leaves the viewport.
    const r = el.menu.getBoundingClientRect();
    const left = Math.max(6, Math.min(x - r.width, window.innerWidth - r.width - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6));
    el.menu.style.left = `${left}px`;
    el.menu.style.top = `${top}px`;
  }

  function openSubmenu() {
    const it = S.menu.items[S.menu.sel];
    if (!it || !it.sub) return;
    S.menu.subItems = agentItems();
    S.menu.subSel = firstSelectable(S.menu.subItems, -1, 1);
    S.menu.inSub = true;
    el.submenu.hidden = false;
    paintMenu();

    const anchor = el.menu.querySelector(`.mi[data-index="${S.menu.sel}"]`);
    const ar = anchor ? anchor.getBoundingClientRect() : el.menu.getBoundingClientRect();
    const mr = el.menu.getBoundingClientRect();
    const sr = el.submenu.getBoundingClientRect();
    // RTL menu: the submenu belongs on the left, and flips right only when the
    // left edge has no room for it.
    let left = mr.left - sr.width + 2;
    if (left < 6) left = Math.min(mr.right - 2, window.innerWidth - sr.width - 6);
    const top = Math.max(6, Math.min(ar.top - 4, window.innerHeight - sr.height - 6));
    el.submenu.style.left = `${left}px`;
    el.submenu.style.top = `${top}px`;
  }

  function closeSubmenu() {
    if (!S.menu) return;
    S.menu.inSub = false;
    S.menu.subItems = null;
    el.submenu.hidden = true;
    paintMenu();
  }

  function closeMenu() {
    S.menu = null;
    el.menu.hidden = true;
    el.submenu.hidden = true;
  }

  function chooseIndex(inSub, i) {
    if (!S.menu) return;
    const items = inSub ? S.menu.subItems : S.menu.items;
    const it = items && items[i];
    if (!it || it.sep || it.title) return;
    if (it.sub) { S.menu.sel = i; openSubmenu(); return; }
    runMenuItem(it, S.menu.target);
  }

  function runMenuItem(it, target) {
    const dir = target ? (target.dir ? target.path : null) : currentDir();
    const folder = dir || currentDir();

    if (it.id.startsWith('agent:')) {
      const id = it.id.slice(6);
      const agent = S.agents.find((a) => a.id === id);
      closeMenu();
      if (agent && !agent.installed) askInstall(agent, folder);
      else act({ act: 'agent', agentId: id, path: folder });
      return;
    }

    closeMenu();
    switch (it.id) {
      case 'open': activate(target); break;
      case 'run': if (target && target.runnable) act({ act: 'run', path: target.path }); break;
      case 'external': act({ act: 'external', path: target.path }); break;
      case 'pdf': act({ act: 'pdf', path: target.path }); break;
      case 'shell': act({ act: 'shell', path: folder }); break;
      case 'window': act({ act: 'window', path: target.path }); break;
      case 'reveal': act({ act: 'reveal', path: target ? target.path : folder }); break;
      case 'copyPath': act({ act: 'copy', text: target ? target.path : folder }); break;
      case 'copyName': act({ act: 'copy', text: target ? target.name : baseName(folder) }); break;
      case 'newFile': askNew(folder, false); break;
      case 'newFolder': askNew(folder, true); break;
      case 'rename': askRename(target); break;
      case 'delete': askDelete(target); break;
      case 'refresh': refresh(); break;
      default: break;
    }
  }

  function refresh() {
    for (const n of S.nodes.values()) { n.children = null; }
    for (const n of S.nodes.values()) { if (n.expanded) requestKids(n.path); }
    openDir(S.cur, { noHistory: true, selectAfter: (selected() || {}).name });
  }

  /* ------------------------------------------------------------ dialogs */

  function showDialog(spec) {
    S.dialog = { spec, sel: 0, buttons: spec.buttons };
    el.dialogwrap.hidden = false;

    const frag = document.createDocumentFragment();
    const h = document.createElement('h3');
    h.textContent = spec.title;
    frag.appendChild(h);

    if (spec.body) {
      const p = document.createElement('p');
      p.textContent = spec.body;
      frag.appendChild(p);
    }

    let input = null;
    if (spec.input !== undefined) {
      input = document.createElement('input');
      input.type = 'text';
      input.value = spec.input;
      input.spellcheck = false;
      frag.appendChild(input);
    }

    const btns = document.createElement('div');
    btns.className = 'btns';
    spec.buttons.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.className = 'dbtn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '') + (i === 0 ? ' on' : '');
      btn.textContent = b.label;
      btn.dataset.index = String(i);
      btn.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pickDialog(i);
      });
      btns.appendChild(btn);
    });
    frag.appendChild(btns);
    el.dialog.replaceChildren(frag);

    S.dialog.input = input;
    if (input) {
      input.focus();
      // Preselect the stem, not the extension — the rename people actually do.
      const dot = input.value.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    } else {
      el.dialog.querySelector('.dbtn').focus();
    }
  }

  function paintDialogSel() {
    el.dialog.querySelectorAll('.dbtn').forEach((b, i) => {
      b.classList.toggle('on', i === S.dialog.sel);
    });
  }

  function closeDialog() {
    S.dialog = null;
    el.dialogwrap.hidden = true;
    el.dialog.replaceChildren();
    focusPane();
  }

  function pickDialog(i) {
    if (!S.dialog) return;
    const spec = S.dialog.spec;
    const value = S.dialog.input ? S.dialog.input.value.trim() : '';
    const btn = spec.buttons[i];
    closeDialog();
    if (btn && btn.id !== 'cancel' && spec.onPick) spec.onPick(btn.id, value);
  }

  function askNew(folder, isFolder) {
    showDialog({
      title: isFolder ? 'תיקייה חדשה' : 'קובץ חדש',
      body: folder,
      input: '',
      buttons: [
        { id: 'ok', label: 'צור', primary: true },
        { id: 'cancel', label: 'ביטול' }
      ],
      onPick: (id, name) => {
        if (id !== 'ok' || !name) return;
        act({ act: isFolder ? 'newFolder' : 'newFile', path: folder, name });
      }
    });
  }

  function askRename(target) {
    if (!target) return;
    showDialog({
      title: 'שינוי שם',
      body: target.path,
      input: target.name,
      buttons: [
        { id: 'ok', label: 'שנה', primary: true },
        { id: 'cancel', label: 'ביטול' }
      ],
      onPick: (id, name) => {
        if (id !== 'ok' || !name || name === target.name) return;
        act({ act: 'rename', path: target.path, name });
      }
    });
  }

  function askDelete(target) {
    if (!target) return;
    showDialog({
      title: `למחוק את «${target.name}»?`,
      body: `${target.path}\nהפריט עובר לסל המיחזור, לא נמחק לצמיתות.`,
      buttons: [
        { id: 'ok', label: 'מחק', danger: true },
        { id: 'cancel', label: 'ביטול', primary: true }
      ],
      onPick: (id) => { if (id === 'ok') act({ act: 'delete', path: target.path }); }
    });
  }

  // A missing agent is never a dead end: the same dialog offers the install and
  // an escape hatch, because "not on PATH" can also mean "PATH changed after VS
  // Code started" — in which case the command runs perfectly well.
  function askInstall(agent, folder) {
    const buttons = [];
    if (agent.pkg) buttons.push({ id: 'install', label: `התקן (npm i -g ${agent.pkg})`, primary: true });
    buttons.push({ id: 'force', label: 'הרץ בכל זאת' });
    buttons.push({ id: 'cancel', label: 'ביטול' });

    showDialog({
      title: `${agent.label} לא נמצא`,
      body: agent.installHint
        || `הפקודה «${agent.bin}» לא נמצאה ב-PATH של VS Code. אם התקנת אותה אחרי שהחלון נפתח, «הרץ בכל זאת» יעבוד — או שאפשר להתקין עכשיו.`,
      buttons,
      onPick: (id) => {
        if (id === 'install') act({ act: 'installAgent', agentId: agent.id });
        if (id === 'force') act({ act: 'agent', agentId: agent.id, path: folder, force: true });
      }
    });
  }

  /* ----------------------------------------------------------- keyboard */

  function focusPane() {
    (S.pane === 'tree' ? el.tree : el.list).focus();
  }

  function moveList(delta, absolute) {
    if (!S.view.length) return;
    S.listSel = absolute !== undefined
      ? Math.max(0, Math.min(S.view.length - 1, absolute))
      : Math.max(0, Math.min(S.view.length - 1, S.listSel + delta));
    renderList();
    scrollIntoPane(el.list, `ls-${S.listSel}`);
  }

  function moveTree(delta, absolute) {
    if (!S.order.length) return;
    const cur = Math.max(0, S.order.indexOf(S.treeSel));
    const next = absolute !== undefined
      ? Math.max(0, Math.min(S.order.length - 1, absolute))
      : Math.max(0, Math.min(S.order.length - 1, cur + delta));
    S.treeSel = S.order[next];
    renderTree();
    scrollIntoPane(el.tree, `tr-${next}`);
    // Arrowing through the tree previews folders in the right pane, but it must
    // not fill the back/forward history — hold ArrowDown for two seconds and
    // "back" would otherwise have forty identical-looking steps to undo. Only a
    // deliberate open (Enter, a click, a breadcrumb) is history.
    openDir(S.treeSel, { noHistory: true });
  }

  // Explorer's type-ahead: letters jump to the next item that starts with what
  // was typed, and the buffer resets after a second of silence.
  function typeAhead(ch) {
    const now = Date.now();
    S.typed = now - S.typedAt > 1000 ? ch : S.typed + ch;
    S.typedAt = now;
    const q = S.typed.toLowerCase();

    if (S.pane === 'list') {
      const from = S.listSel + (S.typed.length === 1 ? 1 : 0);
      for (let k = 0; k < S.view.length; k += 1) {
        const i = (from + k) % S.view.length;
        if (S.view[i].name.toLowerCase().startsWith(q)) { moveList(0, i); return; }
      }
    } else {
      const cur = S.order.indexOf(S.treeSel);
      const from = cur + (S.typed.length === 1 ? 1 : 0);
      for (let k = 0; k < S.order.length; k += 1) {
        const i = (from + k) % S.order.length;
        const n = S.nodes.get(S.order[i]);
        if (n && n.name.toLowerCase().startsWith(q)) { moveTree(0, i); return; }
      }
    }
  }

  function onMenuKey(e) {
    const inSub = S.menu.inSub;
    const items = inSub ? S.menu.subItems : S.menu.items;
    const selKey = inSub ? 'subSel' : 'sel';

    switch (e.key) {
      case 'Escape':
        if (inSub) closeSubmenu(); else closeMenu();
        focusPane();
        break;
      case 'ArrowDown':
        S.menu[selKey] = firstSelectable(items, S.menu[selKey], 1);
        paintMenu();
        break;
      case 'ArrowUp':
        S.menu[selKey] = firstSelectable(items, S.menu[selKey], -1);
        paintMenu();
        break;
      case 'Home':
        S.menu[selKey] = firstSelectable(items, -1, 1);
        paintMenu();
        break;
      case 'End':
        S.menu[selKey] = firstSelectable(items, items.length, -1);
        paintMenu();
        break;
      // The menu is RTL, so its submenu opens to the LEFT — and Left is
      // therefore "go deeper", Right is "come back".
      case 'ArrowLeft':
        if (!inSub && items[S.menu.sel] && items[S.menu.sel].sub) openSubmenu();
        break;
      case 'ArrowRight':
        if (inSub) closeSubmenu();
        break;
      case 'Enter':
      case ' ':
        chooseIndex(inSub, S.menu[selKey]);
        break;
      default:
        return; // not ours — let it through
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onDialogKey(e) {
    const n = S.dialog.buttons.length;
    switch (e.key) {
      case 'Escape':
        closeDialog();
        break;
      case 'Enter':
        // With a text field, Enter means the primary action regardless of which
        // button the eye is on — that is what typing a name and pressing Enter
        // has to do.
        pickDialog(S.dialog.input ? Math.max(0, S.dialog.buttons.findIndex((b) => b.primary)) : S.dialog.sel);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        S.dialog.sel = (S.dialog.sel + 1) % n;
        paintDialogSel();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        S.dialog.sel = (S.dialog.sel - 1 + n) % n;
        paintDialogSel();
        break;
      case 'Tab':
        S.dialog.sel = (S.dialog.sel + (e.shiftKey ? -1 : 1) + n) % n;
        paintDialogSel();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function contextTarget() {
    const t = selected();
    const rowId = S.pane === 'tree' ? `tr-${S.order.indexOf(S.treeSel)}` : `ls-${S.listSel}`;
    const node = document.getElementById(rowId);
    const r = node ? node.getBoundingClientRect() : el.card.getBoundingClientRect();
    return { target: t, x: r.right - 8, y: r.bottom };
  }

  document.addEventListener('keydown', (e) => {
    if (S.dialog) { onDialogKey(e); return; }
    if (S.menu) { onMenuKey(e); return; }

    // The filter box owns its own typing; only the keys that leave it are ours.
    if (document.activeElement === el.filter) {
      if (e.key === 'Escape') {
        if (el.filter.value) { el.filter.value = ''; applyFilter(); renderList(); }
        else { S.pane = 'list'; focusPane(); }
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab') {
        S.pane = 'list';
        focusPane();
        e.preventDefault();
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') { post({ type: 'close' }); e.preventDefault(); return; }
    if (ctrl && (e.key === 'f' || e.key === 'F')) { el.filter.focus(); el.filter.select(); e.preventDefault(); return; }
    if (ctrl && (e.key === 'h' || e.key === 'H')) { toggleHidden(); e.preventDefault(); return; }
    if (ctrl && (e.key === 'r' || e.key === 'R')) { refresh(); e.preventDefault(); return; }
    if (ctrl && e.key === '`') { act({ act: 'shell', path: currentDir() }); e.preventDefault(); return; }

    if (e.key === 'Tab') {
      S.pane = S.pane === 'tree' ? 'list' : 'tree';
      focusPane();
      renderTree();
      renderList();
      e.preventDefault();
      return;
    }

    if (e.key === 'F5' || (ctrl && e.key === 'Enter')) {
      const t = selected();
      if (t && !t.dir && t.runnable) act({ act: 'run', path: t.path });
      else if (e.key === 'F5') refresh();
      e.preventDefault();
      return;
    }

    if (e.key === 'F2') { askRename(selected()); e.preventDefault(); return; }
    if (e.key === 'Delete') { askDelete(selected()); e.preventDefault(); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const c = contextTarget();
      openMenu(c.x, c.y, c.target);
      e.preventDefault();
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') { goBack(); e.preventDefault(); return; }
    if (e.altKey && e.key === 'ArrowRight') { goFwd(); e.preventDefault(); return; }
    if (e.key === 'Backspace') { goUp(); e.preventDefault(); return; }

    if (S.pane === 'tree') {
      switch (e.key) {
        case 'ArrowDown': moveTree(1); break;
        case 'ArrowUp': moveTree(-1); break;
        case 'Home': moveTree(0, 0); break;
        case 'End': moveTree(0, S.order.length - 1); break;
        case 'ArrowRight': {
          const n = S.nodes.get(S.treeSel);
          if (n && !n.expanded) toggleNode(S.treeSel, true);
          else if (n && n.children && n.children.length) moveTree(1);
          break;
        }
        case 'ArrowLeft': {
          const n = S.nodes.get(S.treeSel);
          if (n && n.expanded) toggleNode(S.treeSel, false);
          else {
            const idx = S.order.indexOf(S.treeSel);
            for (let i = idx - 1; i >= 0; i -= 1) {
              if (S.nodes.get(S.order[i]).depth < n.depth) { moveTree(0, i); break; }
            }
          }
          break;
        }
        case 'Enter':
          openDir(S.treeSel, { focusList: true });
          break;
        default:
          if (e.key.length === 1 && !ctrl && !e.altKey) typeAhead(e.key);
          else return;
      }
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case 'ArrowDown': moveList(1); break;
      case 'ArrowUp': moveList(-1); break;
      case 'PageDown': moveList(12); break;
      case 'PageUp': moveList(-12); break;
      case 'Home': moveList(0, 0); break;
      case 'End': moveList(0, S.view.length - 1); break;
      case 'ArrowLeft': S.pane = 'tree'; focusPane(); renderTree(); renderList(); break;
      case 'ArrowRight': {
        const t = selected();
        if (t && t.dir) openDir(t.path, { focusList: true });
        break;
      }
      case 'Enter': activate(selected()); break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) typeAhead(e.key);
        else return;
    }
    e.preventDefault();
  });

  /* ------------------------------------------------------------- wiring */

  function toggleHidden() {
    S.showHidden = !S.showHidden;
    renderNav();
    refresh();
  }

  el.backdrop.addEventListener('mousedown', () => post({ type: 'close' }));
  el.close.addEventListener('mousedown', (e) => { e.preventDefault(); post({ type: 'close' }); });
  el.back.addEventListener('mousedown', (e) => { e.preventDefault(); goBack(); });
  el.fwd.addEventListener('mousedown', (e) => { e.preventDefault(); goFwd(); });
  el.up.addEventListener('mousedown', (e) => { e.preventDefault(); goUp(); });
  el.hidden.addEventListener('mousedown', (e) => { e.preventDefault(); toggleHidden(); });
  el.filter.addEventListener('input', () => { applyFilter(); renderList(); });

  el.tree.addEventListener('focus', () => { S.pane = 'tree'; renderTree(); renderList(); });
  el.list.addEventListener('focus', () => { S.pane = 'list'; renderTree(); renderList(); });

  // A right-click on empty pane space still deserves a menu — it just has no
  // target, so it acts on the folder the pane is showing.
  el.list.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.row')) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, null);
  });

  document.addEventListener('mousedown', (e) => {
    if (S.menu && !el.menu.contains(e.target) && !el.submenu.contains(e.target)) {
      closeMenu();
      e.stopPropagation();
    }
  }, true);

  // The card must not be closed by clicks inside it — only the backdrop closes.
  el.card.addEventListener('mousedown', (e) => e.stopPropagation());

  // Drag the divider. Cheap, and a 290px tree is wrong for deep folder names.
  (function splitter() {
    let dragging = false;
    el.split.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = el.card.getBoundingClientRect().left;
      const w = Math.max(160, Math.min(560, e.clientX - left));
      el.tree.style.flexBasis = `${w}px`;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }());

  /* ------------------------------------------------------ host messages */

  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    switch (m.type) {
      case 'init': {
        S.build = m.build || '';
        S.sep = m.sep || '\\';
        S.roots = m.roots || [];
        S.agents = m.agents || [];
        S.enterRuns = !!m.enterRuns;
        S.showHidden = !!m.showHidden;
        el.build.textContent = `ccm ${S.build}`;
        S.roots.forEach((r) => ensureNode(r.path, r.name, 0));
        rebuildOrder();
        renderTree();
        renderNav();
        if (m.start) openDir(m.start);
        break;
      }
      case 'kids': {
        const n = ensureNode(m.path);
        n.children = (m.entries || []).map((c) => ensureNode(c.path, c.name, n.depth + 1).path);
        n.empty = n.children.length === 0;
        rebuildOrder();
        renderTree();
        if (S.revealTarget) stepReveal();
        break;
      }
      case 'dir': {
        S.cur = m.path;
        S.curParent = m.parent || '';
        S.entries = m.entries || [];
        applyFilter();
        S.listSel = 0;
        if (S.selectAfter) {
          const i = S.view.findIndex((e) => e.name === S.selectAfter);
          if (i >= 0) S.listSel = i;
          S.selectAfter = null;
        }
        renderList();
        renderCrumbs();
        renderNav();
        setStatus(`${S.entries.filter((e) => e.dir).length} תיקיות · ${S.entries.filter((e) => !e.dir).length} קבצים`);
        if (S.treeSel !== m.path) { S.revealTarget = m.path; stepReveal(); }
        focusPane();
        scrollIntoPane(el.list, `ls-${S.listSel}`);
        break;
      }
      case 'selectName': {
        const i = S.view.findIndex((e) => e.name === m.name);
        if (i >= 0) moveList(0, i);
        break;
      }
      case 'agents':
        S.agents = m.agents || [];
        break;
      case 'error': {
        const note = document.createElement('div');
        note.className = 'error-note';
        note.textContent = m.message || 'שגיאה';
        el.list.replaceChildren(note);
        setStatus('');
        break;
      }
      case 'status':
        setStatus(m.message || '');
        break;
      default:
        break;
    }
  });

  // The panel is created with preserveFocus:false, but the iframe still needs to
  // claim focus itself before a keystroke reaches this document.
  window.focus();
  post({ type: 'ready' });
}());
