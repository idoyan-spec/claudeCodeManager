' claude-vscode.vbs  |  BUILD: 2026-07-09 v1  (ccm launcher: VS Code + terminal)
' Opens VS Code on the folder AND a Windows Terminal running Claude (auto) beside it.
' Portable: detects VS Code location at runtime. No SendKeys, no window flicker.
Option Explicit
Dim folder, sh, fso, code, candidates, i, lad, pf, pfx86
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

folder = ""
If WScript.Arguments.Count > 0 Then folder = WScript.Arguments(0)
If folder = "" Then folder = sh.CurrentDirectory

' --- locate VS Code across common install locations ---
lad   = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
pf    = sh.ExpandEnvironmentStrings("%ProgramFiles%")
pfx86 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
candidates = Array( _
  lad   & "\Programs\Microsoft VS Code\Code.exe", _
  pf    & "\Microsoft VS Code\Code.exe", _
  pfx86 & "\Microsoft VS Code\Code.exe" )
code = ""
For i = 0 To UBound(candidates)
  If code = "" Then
    If fso.FileExists(candidates(i)) Then code = candidates(i)
  End If
Next

' 1) Open the folder in VS Code (non-destructive: no -r, so open files are never replaced)
If code <> "" Then
  sh.Run """" & code & """ """ & folder & """", 1, False
Else
  sh.Run "cmd /c code """ & folder & """", 0, False   ' fallback: resolve via PATH
End If

' 2) Open Windows Terminal with Claude (auto mode) beside VS Code
sh.Run "wt.exe -d """ & folder & """ --title ""Claude Auto - ccm v1"" cmd.exe /k claude.exe --dangerously-skip-permissions", 1, False
