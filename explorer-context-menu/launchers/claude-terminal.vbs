' claude-terminal.vbs  |  BUILD: 2026-07-09 v1  (ccm launcher: terminal-only)
' Opens Windows Terminal with Claude (auto mode) in the given folder.
' Launched via wscript.exe -> NO console window, no flicker, no SendKeys.
Option Explicit
Dim folder, sh
folder = ""
If WScript.Arguments.Count > 0 Then folder = WScript.Arguments(0)
Set sh = CreateObject("WScript.Shell")
If folder = "" Then folder = sh.CurrentDirectory

' -d sets start dir; tab title carries a visible build stamp; cmd /k keeps shell open
sh.Run "wt.exe -d """ & folder & """ --title ""Claude Auto - ccm v1"" cmd.exe /k claude.exe --dangerously-skip-permissions", 1, False
