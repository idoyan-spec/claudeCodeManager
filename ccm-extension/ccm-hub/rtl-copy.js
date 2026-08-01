// ccm-hub / rtl-copy.js
//
// Claude Code (verified in the 2.1.220 binary: it bundles bidi-js —
// getEmbeddingLevels / getReorderSegments / mirrored-brackets map) renders
// Hebrew by REORDERING it into visual order, because the terminal itself
// (xterm.js) has no bidi support. The screen looks right, but the terminal
// buffer now holds the characters back-to-front — so a plain copy pastes
// reversed Hebrew everywhere. There is no Claude Code setting to turn the
// reordering off, so the fix happens at copy time: this module converts
// visual-order text back to logical order.
//
// It is the heuristic inverse of bidi-js's per-line UBA reorder:
//   - a line whose base direction was RTL was reversed whole, with embedded
//     Latin/digit islands kept LTR and brackets mirrored → reverse it back,
//     re-reverse the islands, un-mirror the brackets;
//   - a line whose base was LTR had only its Hebrew runs reversed in place
//     → reverse just those runs back.
// Base direction is guessed from the visual text (first strong char, with a
// Hebrew-majority fallback) — exact recovery is impossible without the
// original logical text, but this covers real chat output; edge cases with
// heavily mixed lines may come out imperfect, and the raw copy is always
// available via the terminal's right-click copy.

'use strict';

const HEB = /[֐-׿]/;

// An LTR island inside a reversed RTL run: Latin/digit tokens, optionally
// glued by connector runs so "test.js", "v2.1.220", "claude --version" and
// multi-word English phrases travel as ONE island and keep their inner order.
const LTR_ISLAND = /[A-Za-z0-9]+(?:[ .,:;/\\_\-+@'"]+[A-Za-z0-9]+)*/g;

// UBA mirrors paired brackets in RTL context; reversing the line back leaves
// them mirrored, so they get swapped again — but only OUTSIDE LTR islands,
// where they were never mirrored in the first place.
const MIRROR = {
  '(': ')', ')': '(',
  '[': ']', ']': '[',
  '{': '}', '}': '{',
  '<': '>', '>': '<',
  '«': '»', '»': '«'
};

function mirrorChars(s) {
  return s.replace(/[()[\]{}<>«»]/g, (c) => MIRROR[c]);
}

// Reverse keeping Hebrew combining marks (nikud/teamim, U+0591–U+05C7) glued
// to their base letter — a bare Array.reverse would detach them.
function reverseStr(s) {
  const units = s.match(/[\s\S][֑-ׇ]*/g) || [];
  return units.reverse().join('');
}

// Undo the visual reorder of one RTL segment: reverse the whole thing, then
// restore each LTR island's inner order, and un-mirror brackets between them.
function unreverseRun(seg) {
  const rev = reverseStr(seg);
  let out = '';
  let last = 0;
  LTR_ISLAND.lastIndex = 0;
  let m;
  while ((m = LTR_ISLAND.exec(rev)) !== null) {
    out += mirrorChars(rev.slice(last, m.index)) + reverseStr(m[0]);
    last = m.index + m[0].length;
  }
  return out + mirrorChars(rev.slice(last));
}

function fixLine(line) {
  if (!HEB.test(line)) return line;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
  const lead = m[1], core = m[2], trail = m[3];

  const hebCount = (core.match(/[֐-׿]/g) || []).length;
  const latCount = (core.match(/[A-Za-z]/g) || []).length;
  const firstStrong = (core.match(/[A-Za-z֐-׿]/) || [''])[0];
  const rtlBase = HEB.test(firstStrong) || hebCount > latCount;

  if (rtlBase) return lead + unreverseRun(core) + trail;

  // LTR-base line: only the Hebrew-bounded runs were reversed, in place.
  return (
    lead +
    core.replace(/[֐-׿](?:[^A-Za-z\r\n]*[֐-׿])?/g, unreverseRun) +
    trail
  );
}

// Public entry: fix a whole clipboard payload, line by line.
function fixVisualHebrew(text) {
  if (!text || !HEB.test(text)) return text;
  return text.split(/(\r?\n)/).map((part) => (/^\r?\n$/.test(part) ? part : fixLine(part))).join('');
}

module.exports = { fixVisualHebrew };
