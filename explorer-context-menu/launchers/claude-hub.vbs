' claude-hub.vbs  |  BUILD: 2026-07-09 v2  (ccm launcher: hub via extension)
' Fires vscode://ccm.hub/session so the ccm-hub extension opens a new terminal
' (running Claude auto) in the CURRENT VS Code window. No console flicker.
' If VS Code is CLOSED, it cold-starts a window first, waits for it to be ready,
' then fires the URI (a URI fired at a dead instance is silently dropped).
Option Explicit
Dim folder, sh, fso, code, uri, i, lad, pf, pfx86, candidates

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

folder = ""
If WScript.Arguments.Count > 0 Then folder = WScript.Arguments(0)
If folder = "" Then folder = sh.CurrentDirectory

' locate Code.exe (avoid code.cmd so there is no console window)
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

uri = "vscode://ccm.hub/session?path=" & UrlEncode(folder)

Dim logf, hasWin
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\claude-hub-debug.log"
Log "START folder=" & folder
Log "code exe=" & code

hasWin = CodeWindowOpen()
Log "CodeWindowOpen (before) = " & hasWin

' If no real VS Code WINDOW exists (background processes don't count), open a NEW
' window (-n forces one even when leftover processes linger), wait for the window
' + extension host to be ready, then fire the URI.
If Not hasWin Then
  Log "opening new VS Code window (-n)"
  If code <> "" Then
    sh.Run """" & code & """ -n", 1, False
  Else
    sh.Run "cmd /c code -n", 0, False
  End If
  Dim waited
  waited = 0
  Do While (Not CodeWindowOpen()) And (waited < 25000)
    WScript.Sleep 700
    waited = waited + 700
  Loop
  Log "window appeared after ~" & waited & "ms; waiting 6s for extension host"
  WScript.Sleep 6000
End If

Log "firing URI: " & uri
If code <> "" Then
  sh.Run """" & code & """ --open-url """ & uri & """", 0, False
Else
  sh.Run "cmd /c code --open-url """ & uri & """", 0, False
End If
Log "DONE"

' True only if a visible, titled VS Code window exists (via hub-has-window.ps1,
' run hidden so there is no console flicker).
Function CodeWindowOpen()
  Dim ps1, cmd, rc
  ps1 = fso.GetParentFolderName(WScript.ScriptFullName) & "\hub-has-window.ps1"
  cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
  rc = sh.Run(cmd, 0, True)   ' 0 = hidden window, True = wait for exit code
  CodeWindowOpen = (rc = 0)
End Function

Sub Log(msg)
  Dim f, ts
  On Error Resume Next
  ts = Now
  Set f = fso.OpenTextFile(logf, 8, True)   ' 8=append, create if missing
  f.WriteLine ts & "  " & msg
  f.Close
End Sub

' --- UTF-8 percent-encoding (handles spaces, backslashes, Hebrew) ---
Function UrlEncode(ByVal s)
  Dim k, ch, cp, res
  res = ""
  For k = 1 To Len(s)
    ch = Mid(s, k, 1)
    cp = AscW(ch)
    If cp < 0 Then cp = cp + 65536
    If (cp >= 48 And cp <= 57) Or (cp >= 65 And cp <= 90) Or (cp >= 97 And cp <= 122) Or InStr("-_.~", ch) > 0 Then
      res = res & ch
    Else
      res = res & Utf8Percent(cp)
    End If
  Next
  UrlEncode = res
End Function

Function Utf8Percent(cp)
  Dim r
  If cp <= &H7F Then
    r = "%" & Right("0" & Hex(cp), 2)
  ElseIf cp <= &H7FF Then
    r = "%" & Hex(&HC0 Or (cp \ &H40)) & "%" & Hex(&H80 Or (cp And &H3F))
  Else
    r = "%" & Hex(&HE0 Or (cp \ &H1000)) & "%" & Hex(&H80 Or ((cp \ &H40) And &H3F)) & "%" & Hex(&H80 Or (cp And &H3F))
  End If
  Utf8Percent = r
End Function
