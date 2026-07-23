// ccm-hub / build.js
//
// The single source of truth for the build stamp. Every module that shows a
// version to the user requires it from here, so a bump is one edit and two
// surfaces can never disagree about which build is running.
//
// Shape: "YYYY-MM-DD HH:MM vN label".
//
// Where it is visible: the Alt+O picker's title bar, and the footer of the
// Alt+E file browser. If what you see on screen is not this string, VS Code is
// running an older copy from ~/.vscode/extensions — re-run install-extension.ps1
// and reload the window.
const BUILD = '2026-07-23 23:12 v23 file-browser';

module.exports = { BUILD };
