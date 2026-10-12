# 列出 NewPath / electron 进程的所有可见顶层窗口：位置、显示亲和性、cloak、分层样式、alpha，以及当前前台窗口。
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class Insp {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
  public static string Dump(uint[] pids) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (Array.IndexOf(pids, p) < 0 || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      uint aff; GetWindowDisplayAffinity(h, out aff);
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      int ex = GetWindowLong(h, -20);
      uint key; byte alpha; uint flags; bool la = GetLayeredWindowAttributes(h, out key, out alpha, out flags);
      var t = new StringBuilder(256); GetWindowTextW(h, t, 256);
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      sb.AppendFormat("hwnd={0} pid={1} cls={2} title='{3}' rect={4},{5} {6}x{7} affinity={8} cloaked={9} layered={10} noactivate={11} mousePassThrough={12} topmost={13} layeredAlpha={14}\n",
        h, p, c, t, r.L, r.T, r.R - r.L, r.B - r.T, aff, cloaked, (ex & 0x80000) != 0, (ex & 0x8000000) != 0, (ex & 0x20) != 0, (ex & 0x8) != 0, la ? alpha.ToString() : "-");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
Add-Type -TypeDefinition $src
$procs = Get-Process electron, NewPath -ErrorAction SilentlyContinue
$pids = [uint32[]]($procs | ForEach-Object { [uint32]$_.Id })
$fg = [Insp]::GetForegroundWindow()
$fgpid = [uint32]0; [Insp]::GetWindowThreadProcessId($fg, [ref]$fgpid) | Out-Null
$t = New-Object System.Text.StringBuilder 256; [Insp]::GetWindowTextW($fg, $t, 256) | Out-Null
$fgName = (Get-Process -Id $fgpid -ErrorAction SilentlyContinue).ProcessName
"FOREGROUND hwnd=$fg pid=$fgpid proc=$fgName title='$($t.ToString())'"
[Insp]::Dump($pids)
