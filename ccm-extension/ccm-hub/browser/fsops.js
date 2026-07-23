// ccm-hub / browser/fsops.js  |  see ../build.js for the build stamp
//
// Everything the file browser needs to know about the disk, and nothing about
// VS Code — so it is testable with plain Node (see ../../test-extension.js).
//
// The browser reads directories from the EXTENSION HOST, not from the webview.
// A webview is a sandboxed iframe with no filesystem access at all, so every
// listing crosses postMessage. That is also why listings are shaped here into
// exactly what the UI renders (name, kind, size, mtime, runner) instead of
// shipping raw Dirents and formatting on the far side.

const fs = require('fs');
const path = require('path');

// How a file is executed, by extension. `argv` is the argument vector; the
// caller quotes it for whatever shell the terminal happens to be running.
//
// A file whose extension is not here is not "unrunnable" — it falls through to
// the operating system's own association (Start-Process / xdg-open), which is
// what double-clicking it in Explorer would do.
const RUNNERS = {
  '.ps1': (p) => ['powershell', '-ExecutionPolicy', 'Bypass', '-File', p],
  '.js': (p) => ['node', p],
  '.mjs': (p) => ['node', p],
  '.cjs': (p) => ['node', p],
  '.ts': (p) => ['npx', 'tsx', p],
  '.py': (p) => ['python', p],
  '.pyw': (p) => ['python', p],
  '.rb': (p) => ['ruby', p],
  '.php': (p) => ['php', p],
  '.pl': (p) => ['perl', p],
  '.lua': (p) => ['lua', p],
  '.go': (p) => ['go', 'run', p],
  '.sh': (p) => ['bash', p],
  '.bash': (p) => ['bash', p],
  '.bat': (p) => [p],
  '.cmd': (p) => [p],
  '.exe': (p) => [p],
  '.jar': (p) => ['java', '-jar', p]
};

// Extensions that have a runner OR are executables the OS will launch. Drives
// the ▶ affordance on a row: showing it on a .txt would be a lie.
function runnerFor(fsPath) {
  const ext = path.extname(fsPath).toLowerCase();
  const make = RUNNERS[ext];
  return make ? make(fsPath) : null;
}

// A rough file-kind used only to pick the row glyph. Deliberately coarse: this
// is decoration, and a wrong guess costs nothing.
const KIND_BY_EXT = {
  '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code',
  '.jsx': 'code', '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code',
  '.java': 'code', '.cs': 'code', '.c': 'code', '.h': 'code', '.cpp': 'code',
  '.php': 'code', '.lua': 'code', '.sql': 'code',
  '.ps1': 'script', '.sh': 'script', '.bash': 'script', '.bat': 'script', '.cmd': 'script', '.vbs': 'script',
  '.exe': 'binary', '.msi': 'binary', '.dll': 'binary', '.jar': 'binary',
  '.md': 'doc', '.markdown': 'doc', '.txt': 'doc', '.pdf': 'doc', '.docx': 'doc', '.rtf': 'doc',
  '.json': 'data', '.yml': 'data', '.yaml': 'data', '.xml': 'data', '.csv': 'data', '.toml': 'data', '.ini': 'data',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image', '.ico': 'image', '.bmp': 'image',
  '.mp3': 'media', '.wav': 'media', '.mp4': 'media', '.mov': 'media', '.mkv': 'media', '.m4a': 'media',
  '.zip': 'archive', '.7z': 'archive', '.rar': 'archive', '.gz': 'archive', '.tar': 'archive'
};

function kindOf(name) {
  return KIND_BY_EXT[path.extname(name).toLowerCase()] || 'file';
}

// Folders before files, then case-insensitive by name — Explorer's order, which
// is the order the user's hands already expect.
function compareEntries(a, b) {
  if (a.dir !== b.dir) return a.dir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

// One directory, shaped for the UI.
//
// `showHidden` false drops dot-entries and (on Windows) anything the filesystem
// flags Hidden or System — node exposes those bits as `Stats.mode`? It does not;
// they live in the undocumented `attributes` field only on some platforms. So we
// use the portable rule the user can actually predict: a leading dot, plus the
// two Windows names that are always noise.
const ALWAYS_HIDDEN = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information']);

function readDir(dir, { showHidden = false } = {}) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const e = new Error(`לא ניתן לקרוא את «${dir}» — ${err.message}`);
    e.code = err.code;
    throw e;
  }

  for (const ent of entries) {
    const name = ent.name;
    if (ALWAYS_HIDDEN.has(name.toLowerCase())) continue;
    if (!showHidden && name.startsWith('.')) continue;

    const full = path.join(dir, name);
    // A symlink reports isDirectory() false on the Dirent (which describes the
    // link, not the target), so directories reached through a junction — normal
    // on Windows — would land in the file list. stat() follows the link; when it
    // dangles we fall back to the Dirent's own answer rather than dropping the row.
    let dirFlag = ent.isDirectory();
    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(full);
      dirFlag = st.isDirectory();
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      /* dangling link or permission denied — show it with what we have */
    }

    out.push({
      name,
      path: full,
      dir: dirFlag,
      size: dirFlag ? 0 : size,
      mtime,
      kind: dirFlag ? 'folder' : kindOf(name),
      runnable: dirFlag ? false : Boolean(runnerFor(full)),
      link: ent.isSymbolicLink()
    });
  }

  return out.sort(compareEntries);
}

// Subdirectories only — what the tree pane needs. Reads the same way readDir
// does so both panes agree about what is hidden.
function readSubdirs(dir, opts) {
  return readDir(dir, opts).filter((e) => e.dir);
}

// Does `dir` contain at least one subdirectory? Decides whether a tree row gets
// an expander arrow. Stops at the first hit instead of listing the whole folder,
// which matters on a node_modules with 40k entries.
function hasSubdirs(dir, { showHidden = false } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const ent of entries) {
    if (!showHidden && ent.name.startsWith('.')) continue;
    if (ALWAYS_HIDDEN.has(ent.name.toLowerCase())) continue;
    if (ent.isDirectory()) return true;
    if (ent.isSymbolicLink()) {
      try {
        if (fs.statSync(path.join(dir, ent.name)).isDirectory()) return true;
      } catch {
        /* dangling */
      }
    }
  }
  return false;
}

// The chain of ancestors from a root down to `target`, inclusive — what the tree
// has to expand to reveal a folder the user reached from the list pane.
// Returns [] when `target` is not under `root`.
function ancestryWithin(root, target) {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
  const chain = [root];
  if (!rel) return chain;
  let cur = root;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    chain.push(cur);
  }
  return chain;
}

// The parent of `p`, or '' when p is a filesystem root (path.dirname('E:\\')
// returns 'E:\\' itself, which would make "go up" a silent no-op forever).
function parentOf(p) {
  const up = path.dirname(p);
  return up === p ? '' : up;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

module.exports = {
  RUNNERS,
  runnerFor,
  kindOf,
  readDir,
  readSubdirs,
  hasSubdirs,
  ancestryWithin,
  parentOf,
  formatSize,
  compareEntries
};
