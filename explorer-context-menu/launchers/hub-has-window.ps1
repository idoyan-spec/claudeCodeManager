# hub-has-window.ps1  |  BUILD: 2026-07-09 v1
# Exit 0 if a real (visible, titled) VS Code WINDOW exists; exit 1 otherwise.
# VS Code is Electron: background "Code.exe" processes linger after the window
# is closed, so a plain process check is not enough — we enumerate top-level
# windows owned by a "Code" process.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HubWin {
  public delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(E f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static bool Find(uint[] pids){
    bool f=false;
    EnumWindows((h,l)=>{
      if(!IsWindowVisible(h))return true;
      if(GetWindowTextLength(h)==0)return true;
      uint p; GetWindowThreadProcessId(h,out p);
      foreach(uint x in pids){ if(x==p){f=true;return false;} }
      return true;
    }, IntPtr.Zero);
    return f;
  }
}
"@
$pids = @(Get-Process code -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
if ($pids.Count -gt 0 -and [HubWin]::Find($pids)) { exit 0 } else { exit 1 }
