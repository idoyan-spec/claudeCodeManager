// ccm-hub / projects.js  |  BUILD: 2026-07-10 09:04 v14 close-guard
//
// The recency model behind the project picker.
//
// "Most recently entered" has two sources, and neither alone is enough:
//
//   1. `globalState` — folders opened through the picker itself. Exact, but empty
//      on a fresh install and blind to sessions started any other way (`ccm.ps1`,
//      the Explorer context menu, a bare `claude` in a terminal).
//
//   2. `~/.claude/projects/<encoded-cwd>/` — Claude Code's own per-project history
//      directory. It is touched whenever Claude actually runs there, no matter how
//      the session was launched. This is what makes the very first Alt+O already
//      show a correct order.
//
// We take max() of the two, so the list is right on day one and self-heals for
// sessions opened outside the picker.
//
// Encoding: Claude derives the directory name by replacing every non-alphanumeric
// character in the absolute cwd with '-'. Verified against this machine's history
// (15/30 folders matched exactly; the other 15 are folders Claude has never run
// in). Because BOTH '\' and '/' collapse to '-', the separator style of the path
// we build here does not matter — a welcome robustness.
//
// The mapping is LOSSY and therefore one-way: 'הקלטה לקלוד' encodes to a run of
// dashes and cannot be decoded back. So we only ever encode FORWARD, from a real
// folder we found on disk. Never try to read the folder list out of ~/.claude.
//
// Directory mtime alone is not trustworthy: on NTFS a directory's mtime moves when
// a file is created or removed inside it, but NOT when an existing file is appended
// to — and a long Claude session is one long append to a single .jsonl. So we take
// the newest mtime among the directory and its .jsonl transcripts.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

function encodeProjectDir(absPath) {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

// Newest mtime (ms) of Claude's history for `absPath`, or 0 if it never ran there.
function historyStamp(absPath) {
  // Windows drive letters are case-insensitive on disk but not in a string compare,
  // and Claude records the cwd with whatever case the shell handed it.
  const candidates = new Set([
    encodeProjectDir(absPath),
    encodeProjectDir(absPath.charAt(0).toUpperCase() + absPath.slice(1)),
    encodeProjectDir(absPath.charAt(0).toLowerCase() + absPath.slice(1))
  ]);

  let newest = 0;
  for (const name of candidates) {
    const dir = path.join(CLAUDE_PROJECTS, name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
      newest = Math.max(newest, fs.statSync(dir).mtimeMs);
    } catch {
      continue; // no history for this folder
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      try {
        newest = Math.max(newest, fs.statSync(path.join(dir, e.name)).mtimeMs);
      } catch { /* vanished mid-scan */ }
    }
  }
  return newest;
}

// Immediate subdirectories of `root`, skipping dot-folders.
function listProjectFolders(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
}

// Folders under `root`, newest-used first. `mru` is { [absPath]: epochMs }.
// Folders Claude has never run in sort last, alphabetically among themselves.
function rankedProjects(root, mru) {
  return listProjectFolders(root)
    .map((name) => {
      const fsPath = path.join(root, name);
      const stamp = Math.max(Number(mru[fsPath]) || 0, historyStamp(fsPath));
      return { name, fsPath, stamp };
    })
    .sort((a, b) =>
      b.stamp - a.stamp || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
}

function ago(ms, now) {
  if (!ms) return 'never opened';
  const sec = Math.max(0, (now - ms) / 1000);
  if (sec < 90) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  const day = hr / 24;
  if (day < 7) return `${Math.floor(day)}d ago`;
  if (day < 60) return `${Math.floor(day / 7)}w ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

module.exports = { encodeProjectDir, historyStamp, listProjectFolders, rankedProjects, ago };
