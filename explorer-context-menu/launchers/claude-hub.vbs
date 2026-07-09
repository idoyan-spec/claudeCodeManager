' claude-hub.vbs  |  BUILD: 2026-07-09 v1  (ccm launcher: hub via extension)
' Fires vscode://ccm.hub/session so the ccm-hub extension opens a new terminal
' (running Claude auto) in the CURRENT VS Code window. No console flicker.
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

If code <> "" Then
  sh.Run """" & code & """ --open-url """ & uri & """", 0, False
Else
  sh.Run "cmd /c code --open-url """ & uri & """", 0, False   ' fallback via PATH
End If

' --- UTF-8 percent-encoding (handles spaces, backslashes, Hebrew) ---
Function UrlEncode(ByVal s)
  Dim k, ch, cp, res
  res = ""
  For k = 1 To Len(s)
    ch = Mid(s, k, 1)
    cp = AscW(ch)
    If cp < 0 Then cp = cp + 65536   ' AscW returns signed
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
