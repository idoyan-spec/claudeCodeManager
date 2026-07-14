/*
 * md2pdf/render.js  -  Markdown -> PDF with correct RTL, no npm, no network.
 *
 * BUILD: 2026-07-14 22:30 v18 md-rtl-pdf
 *
 * Rendering:  vendored marked (MIT) turns Markdown into HTML.
 * Printing:   a headless Chrome/Edge already on the machine prints the HTML to
 *             PDF via `--print-to-pdf`. Chromium's own layout engine gets Hebrew
 *             bidi right (validated: heading/bullets/blockquote all flip to the
 *             right, inline English/code stay LTR), so there is nothing to hand-roll.
 *
 * Why not Puppeteer (what the html-to-pdf skill uses): it pulls a ~300MB npm
 * dependency and a second Chromium. This project is deliberately buildless, and
 * every Windows box already ships Edge - so we drive the installed browser directly.
 *
 * Direction:  auto-detected from the content (any Hebrew/Arabic letters -> rtl),
 *             or forced with dir:'rtl' / dir:'ltr'. Auto is what makes "just export"
 *             do the right thing for a Hebrew doc while leaving English LTR.
 *
 * Usable two ways:
 *   - require('./render.js').exportMarkdownToPdf({...})   (the extension does this)
 *   - node render.js input.md output.pdf [--rtl|--ltr]    (tests / other tools)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const marked = (() => {
  const m = require('./marked.min.js');
  return m.marked || m;
})();

// --- browser discovery -----------------------------------------------------
// Chrome first (what we validated), Edge as the always-present Windows fallback.
// CCM_PDF_BROWSER can pin an explicit exe if a machine hides the browser somewhere odd.
function findBrowser() {
  if (process.env.CCM_PDF_BROWSER && fs.existsSync(process.env.CCM_PDF_BROWSER)) {
    return process.env.CCM_PDF_BROWSER;
  }
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const candidates = [
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    local && path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return null;
}

// --- direction detection ---------------------------------------------------
const RTL_RE = /[֐-׿؀-ۿ܀-ݏ]/;   // Hebrew + Arabic + Syriac
function detectDir(text) { return RTL_RE.test(text) ? 'rtl' : 'ltr'; }

// A file:// URL with a trailing slash so relative images/links in the .md resolve
// against the document's own folder.
function dirBaseHref(mdPath) {
  let p = path.dirname(path.resolve(mdPath)).replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';
  return 'file:///' + p.replace(/^\/+/, '');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- HTML template ---------------------------------------------------------
// System fonts only (offline-safe). The whole document takes `dir`; code blocks
// and inline code are pinned LTR because code is never RTL. Page-break rules keep
// headings, code, images and table rows from being sliced across a page edge.
function buildHtml({ bodyHtml, dir, title, baseHref }) {
  const align = dir === 'rtl' ? 'right' : 'left';
  return `<!DOCTYPE html>
<html lang="${dir === 'rtl' ? 'he' : 'en'}" dir="${dir}">
<head>
<meta charset="UTF-8">
<base href="${baseHref}">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Arial", "Noto Sans Hebrew", sans-serif;
    direction: ${dir}; text-align: ${align};
    line-height: 1.7; color: #1a1a1a; font-size: 12pt;
    margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { color: #0a4a75; line-height: 1.3; margin: 1.1em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 2em; border-bottom: 2px solid #0a4a75; padding-bottom: .2em; }
  h2 { font-size: 1.55em; border-bottom: 1px solid #cbd5e0; padding-bottom: .15em; }
  h3 { font-size: 1.3em; }
  p, ul, ol, blockquote, table, pre { margin: 0.6em 0; }
  ul, ol { padding-${dir === 'rtl' ? 'right' : 'left'}: 1.6em; padding-${dir === 'rtl' ? 'left' : 'right'}: 0; }
  li { margin: .2em 0; }
  a { color: #0a67b3; text-decoration: none; }
  code {
    font-family: "Cascadia Code", "Consolas", monospace; font-size: .92em;
    background: #f0f2f5; padding: 2px 6px; border-radius: 4px;
    direction: ltr; unicode-bidi: embed;
  }
  pre {
    background: #f6f8fa; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 12px 14px; overflow-x: auto; direction: ltr; text-align: left;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; border-radius: 0; font-size: .88em; }
  blockquote {
    border-${dir === 'rtl' ? 'right' : 'left'}: 4px solid #0a4a75;
    border-${dir === 'rtl' ? 'left' : 'right'}: 0;
    margin: .8em 0; padding: .1em 1em; color: #4a5568; background: #f8fafc;
  }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e0; padding: 7px 10px; text-align: ${align}; }
  th { background: #eef2f7; }
  tr { page-break-inside: avoid; }
  img { max-width: 100%; page-break-inside: avoid; }
  hr { border: 0; border-top: 1px solid #cbd5e0; margin: 1.4em 0; }
  input[type="checkbox"] { margin-${dir === 'rtl' ? 'left' : 'right'}: .4em; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// --- print via headless browser --------------------------------------------
function printToPdf(browser, htmlPath, pdfPath, timeoutMs, log) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-pdf-'));
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      'file:///' + htmlPath.replace(/\\/g, '/').replace(/^\/+/, ''),
    ];
    log && log(`browser: ${path.basename(browser)}`);
    const child = spawn(browser, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PDF print timed out'));
    }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('exit', code => {
      clearTimeout(timer);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) return resolve(pdfPath);
      reject(new Error(`browser exited ${code} without a PDF. ${stderr.slice(-400)}`));
    });
  });
}

/**
 * exportMarkdownToPdf - render a .md file to a .pdf next to it (or at pdfPath).
 * @returns {Promise<{pdfPath, dir, browser}>}
 */
async function exportMarkdownToPdf(opts) {
  const mdPath = path.resolve(opts.mdPath);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown file not found: ${mdPath}`);
  const pdfPath = path.resolve(opts.pdfPath || mdPath.replace(/\.(md|markdown)$/i, '') + '.pdf');
  const log = opts.log || (() => {});

  const browser = findBrowser();
  if (!browser) {
    throw new Error('No Chrome or Edge found for PDF printing. Set CCM_PDF_BROWSER to a chrome.exe/msedge.exe.');
  }

  const raw = fs.readFileSync(mdPath, 'utf8');
  const dir = (opts.dir === 'rtl' || opts.dir === 'ltr') ? opts.dir : detectDir(raw);
  log(`direction: ${dir}${opts.dir ? ' (forced)' : ' (auto)'}`);

  const bodyHtml = marked.parse(raw, { gfm: true, breaks: false });
  const html = buildHtml({
    bodyHtml, dir,
    title: path.basename(mdPath),
    baseHref: dirBaseHref(mdPath),
  });

  const tmpHtml = path.join(os.tmpdir(), `ccm-md-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');
  try {
    await printToPdf(browser, tmpHtml, pdfPath, opts.timeoutMs || 60000, log);
  } finally {
    // CCM_MD_KEEP_HTML leaves the intermediate HTML on disk for inspection.
    if (process.env.CCM_MD_KEEP_HTML) log(`html kept: ${tmpHtml}`);
    else { try { fs.unlinkSync(tmpHtml); } catch (_) {} }
  }
  return { pdfPath, dir, browser };
}

module.exports = { exportMarkdownToPdf, detectDir, findBrowser };

// --- CLI -------------------------------------------------------------------
if (require.main === module) {
  const a = process.argv.slice(2);
  const input = a.find(x => !x.startsWith('--') && /\.(md|markdown)$/i.test(x));
  const output = a.find(x => !x.startsWith('--') && /\.pdf$/i.test(x));
  const dir = a.includes('--rtl') ? 'rtl' : a.includes('--ltr') ? 'ltr' : undefined;
  if (!input) {
    console.error('usage: node render.js <input.md> [output.pdf] [--rtl|--ltr]');
    process.exit(2);
  }
  exportMarkdownToPdf({ mdPath: input, pdfPath: output, dir, log: m => console.error('  ' + m) })
    .then(r => { console.log(r.pdfPath); })
    .catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
