// ccm-hub / browser/agents.js  |  see ../build.js for the build stamp
//
// The registry of coding agents the file browser can open a terminal on, and the
// PATH probe that decides which of them actually exist on this machine.
//
// WHY A HAND-ROLLED PROBE AND NOT `where.exe` / `which`:
// the context menu is built the moment the panel opens, so the answer has to be
// there in single-digit milliseconds. Spawning one child process per agent (8+
// of them) costs ~40-60ms each on Windows and would show the menu after a
// visible stutter. Walking PATH with existsSync is a few dozen stat() calls and
// returns in ~1-3ms. It is also exactly what the shell itself does.
//
// The probe can produce a FALSE NEGATIVE — an agent installed somewhere that is
// on the shell's PATH but not on the extension host's (a PATH edit made after
// VS Code started is the common case, since a process inherits the environment
// it was launched with and never sees later changes). So "not found" is never
// treated as "cannot run": the menu still lists the agent, greyed, and offers
// both "install" and "run anyway". Nothing here can lock the user out of an
// agent they have.

const fs = require('fs');
const os = require('os');
const path = require('path');

// The built-in agents, in menu order. Fields:
//   id       stable key, used by the webview and by `ccmHub.browser.agents` overrides
//   label    what the menu shows
//   glyph    a colour block so the eye finds the row before it reads it
//   bin      the executable name to look for on PATH
//   command  what is typed into the new terminal
//   pkg      npm package for the one-click install, or null when npm is not how
//            this agent is distributed (then `installHint` explains what is)
const BUILTIN_AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    glyph: '🟧',
    bin: 'claude',
    // Left empty on purpose: Claude's command line is already user-configurable
    // as `ccmHub.claudeCommand`, and the browser reads that so both entry points
    // (Alt+O and this menu) launch Claude exactly the same way.
    command: null,
    pkg: '@anthropic-ai/claude-code'
  },
  {
    id: 'codex',
    label: 'Codex',
    glyph: '🟩',
    bin: 'codex',
    command: 'codex',
    pkg: '@openai/codex'
  },
  {
    id: 'gemini',
    label: 'Gemini',
    glyph: '🔷',
    bin: 'gemini',
    command: 'gemini',
    pkg: '@google/gemini-cli'
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    glyph: '⬛',
    bin: 'copilot',
    command: 'copilot',
    pkg: '@github/copilot'
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    glyph: '⬜',
    bin: 'cursor-agent',
    command: 'cursor-agent',
    pkg: null,
    installHint: 'Cursor Agent מותקן מ-cursor.com/cli, לא מ-npm.'
  },
  {
    id: 'opencode',
    label: 'opencode',
    glyph: '🟪',
    bin: 'opencode',
    command: 'opencode',
    pkg: 'opencode-ai'
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    glyph: '🟥',
    bin: 'qwen',
    command: 'qwen',
    pkg: '@qwen-code/qwen-code'
  },
  {
    id: 'aider',
    label: 'Aider',
    glyph: '🟦',
    bin: 'aider',
    command: 'aider',
    pkg: null,
    installHint: 'Aider הוא כלי פייתון: התקנה ב-`python -m pip install aider-install`.'
  }
];

// Extensions Windows treats as directly executable. An agent installed by npm on
// Windows is a `.cmd` shim, never an extensionless file, so this list is what
// makes the probe work at all here. On POSIX the empty string is the only entry
// that matters and the rest simply never match.
function execExtensions() {
  if (process.platform !== 'win32') return [''];
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return ['', ...raw.split(';').filter(Boolean).map((e) => e.toLowerCase())];
}

// Directories to probe: everything on PATH, plus two locations that hold agent
// binaries but are missing from a freshly-inherited PATH often enough to matter
// (Claude's own installer writes to ~/.local/bin; npm's global bin is only on
// PATH once a shell has been restarted since the install).
function searchDirs() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm')
  ];
  for (const d of extra) if (!dirs.includes(d)) dirs.push(d);
  return dirs;
}

// The absolute path of `bin`, or '' when nothing on PATH provides it.
function whichSync(bin, dirs, exts) {
  if (!bin) return '';
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* not here — keep looking */
      }
    }
  }
  return '';
}

// User-defined agents from `ccmHub.browser.agents`, merged over the built-ins by
// id. So a user can add an agent we never heard of, and can also retarget one we
// ship (e.g. point `gemini` at a wrapper script) without losing the rest.
function mergeCustom(builtin, custom) {
  const byId = new Map(builtin.map((a) => [a.id, { ...a }]));
  for (const raw of Array.isArray(custom) ? custom : []) {
    if (!raw || !raw.id) continue;
    const existing = byId.get(raw.id) || { id: raw.id, glyph: '🤖', pkg: null };
    byId.set(raw.id, {
      ...existing,
      ...raw,
      // A custom entry that names a command but no binary is still probeable:
      // the first word of the command is the binary in every realistic case.
      bin: raw.bin || existing.bin || String(raw.command || '').trim().split(/\s+/)[0]
    });
  }
  return [...byId.values()];
}

// Every agent, each stamped with whether it is installed and what to run.
// `claudeCommand` is threaded in so the Claude row honours the same setting the
// Alt+O picker uses.
function listAgents({ custom, claudeCommand } = {}) {
  const dirs = searchDirs();
  const exts = execExtensions();
  return mergeCustom(BUILTIN_AGENTS, custom).map((a) => {
    const bin = a.bin || a.id;
    const found = whichSync(bin, dirs, exts);
    const command =
      a.id === 'claude' && !a.command ? claudeCommand || 'claude' : a.command || bin;
    return {
      id: a.id,
      label: a.label || a.id,
      glyph: a.glyph || '🤖',
      bin,
      command,
      pkg: a.pkg || null,
      installHint: a.installHint || null,
      installed: Boolean(found),
      resolved: found
    };
  });
}

module.exports = { BUILTIN_AGENTS, listAgents, whichSync, searchDirs, execExtensions };
