// 在一次滚动截图进行中，从操作系统角度检查彩环 / 面板窗口：可见、未被 cloak、显示亲和性、分层样式、前台窗口是谁。
import { execFileSync } from "node:child_process";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page");
const find = async (w, timeout = 15000) => { const s = Date.now(); while (Date.now() - s < timeout) { const t = (await targets()).find((t) => t.url.includes(`windowType=${w}`)); if (t) return t; await sleep(300); } throw new Error(`no ${w}`); };
class Cdp { constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); }
	static async connect(t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }); return new Cdp(ws); }
	send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.p.set(id, { resolve: res, reject: rej })); }
	async eval(e) { const r = await this.send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result.value; } }

const PS = String.raw`
Add-Type -Namespace W -Name U -MemberDefinition @'
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
[DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
public struct RECT { public int L, T, R, B; }
'@
$pids = (Get-Process electron, NewPath -ErrorAction SilentlyContinue).Id
$fg = [W.U]::GetForegroundWindow()
$fgpid = 0; [W.U]::GetWindowThreadProcessId($fg, [ref]$fgpid) | Out-Null
$sb = New-Object System.Text.StringBuilder 256
[W.U]::GetWindowTextW($fg, $sb, 256) | Out-Null
"FOREGROUND hwnd=$fg pid=$fgpid proc=$((Get-Process -Id $fgpid -ErrorAction SilentlyContinue).ProcessName) title=$($sb.ToString())"
[W.U]::EnumWindows({ param($h, $l)
  $p = 0; [W.U]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  if ($pids -notcontains $p) { return $true }
  if (-not [W.U]::IsWindowVisible($h)) { return $true }
  $r = New-Object W.U+RECT; [W.U]::GetWindowRect($h, [ref]$r) | Out-Null
  $aff = 0; [W.U]::GetWindowDisplayAffinity($h, [ref]$aff) | Out-Null
  $cloaked = 0; [W.U]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4) | Out-Null
  $ex = [W.U]::GetWindowLong($h, -20)
  $key = 0; $alpha = [byte]0; $flags = 0; $la = [W.U]::GetLayeredWindowAttributes($h, [ref]$key, [ref]$alpha, [ref]$flags)
  $t = New-Object System.Text.StringBuilder 256; [W.U]::GetWindowTextW($h, $t, 256) | Out-Null
  $c = New-Object System.Text.StringBuilder 256; [W.U]::GetClassNameW($h, $c, 256) | Out-Null
  "hwnd=$h cls=$($c.ToString()) title='$($t.ToString())' rect=$($r.L),$($r.T),$($r.R - $r.L)x$($r.B - $r.T) affinity=$aff cloaked=$cloaked layered=$(($ex -band 0x80000) -ne 0) noactivate=$(($ex -band 0x8000000) -ne 0) transparentEx=$(($ex -band 0x20) -ne 0) layeredAttr=$la alpha=$alpha"
  return $true }, [IntPtr]::Zero) | Out-Null
`;
const inspect = () => execFileSync("powershell.exe", ["-NoProfile", "-Command", PS], { encoding: "utf8" }).trim();

const main = await Cdp.connect(await find("main"));
await main.eval("window.electronAPI.startCapture()"); main.ws.close();
await sleep(1800);
const region = await Cdp.connect(await find("screenshot-region"));
await sleep(800);
const mouse = (type, x, y, extra = {}) => region.send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
await mouse("mouseMoved", 1700, 950); await sleep(500);
await mouse("mousePressed", 1700, 950, { clickCount: 1 }); await mouse("mouseReleased", 1700, 950, { clickCount: 1 });
await sleep(300);
console.log("== 选区阶段 ==\n" + inspect());
await region.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", text: "s", windowsVirtualKeyCode: 83 });
await region.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
await sleep(200);
await region.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await region.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
region.ws.close();
const panel = await Cdp.connect(await find("scroll-capture"));
await sleep(1500);
console.log("== 滚动阶段 ==\n" + inspect());
await panel.eval("window.electronAPI.cancelScroll()");
panel.ws.close();
await sleep(800);
console.log("== 取消后 ==\n" + inspect());
process.exit(0);
