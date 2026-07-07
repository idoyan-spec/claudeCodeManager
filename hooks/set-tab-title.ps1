# Set the Windows Terminal tab title.
# Strategy: walk up the process tree to find an ancestor that owns a real console
# (cmd.exe / powershell.exe / WindowsTerminal.exe). Detach from our own console,
# attach to the ancestor's, then call SetConsoleTitle. WT reads the console title
# from the conpty and mirrors it to the focused tab.
param([string]$Title)
if (-not $Title) { exit 1 }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool SetConsoleTitle(string lpConsoleTitle);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool SetWindowText(IntPtr hWnd, string lpString);
}
"@ -ErrorAction SilentlyContinue

function Get-ParentId([int]$id) {
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop
    return [int]$cim.ParentProcessId
  } catch { return 0 }
}

# Walk up until WindowsTerminal — collect candidate console-owning ancestors.
# IMPORTANT: skip our own process. Attaching to our own (inner) console
# "succeeds" but writes to Claude Code's child conpty, which WT never sees.
# We want the OUTER cmd.exe that WT spawned — its console title is what WT mirrors to the tab.
$candidates = @()
$wtProc = $null
$cur = Get-Process -Id $PID
while ($cur) {
  if ($cur.ProcessName -eq 'WindowsTerminal') { $wtProc = $cur; break }
  if ($cur.Id -ne $PID -and $cur.ProcessName -in @('cmd','powershell','pwsh','conhost')) {
    $candidates += $cur.Id
  }
  $pid2 = Get-ParentId $cur.Id
  if (-not $pid2) { break }
  try { $cur = Get-Process -Id $pid2 -ErrorAction Stop } catch { $cur = $null }
}

$ok = $false
[Win32]::FreeConsole() | Out-Null
foreach ($id in $candidates) {
  if ([Win32]::AttachConsole([uint32]$id)) {
    if ([Win32]::SetConsoleTitle($Title)) { $ok = $true }
    [Win32]::FreeConsole() | Out-Null
    if ($ok) { break }
  }
}

# Belt-and-suspenders: also poke the WT window title directly.
if ($wtProc -and $wtProc.MainWindowHandle -ne 0) {
  [Win32]::SetWindowText($wtProc.MainWindowHandle, $Title) | Out-Null
}

if ($ok) { exit 0 } else { exit 1 }
