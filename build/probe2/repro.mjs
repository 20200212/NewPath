// 复现：单击最大化窗口（选区≈整屏）→ 滚动截图，监测主进程响应延迟、CPU、面板窗口是否可见。
import { execFileSync } from "node:child_process";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page");
const find = async (w, timeout = 15000) => { const s = Date.now(); while (Date.now() - s < timeout) { const t = (await targets()).find((t) => t.url.includes(`windowType=${w}`)); if (t) return t; await sleep(300); } throw new Error(`no ${w}`); };
class Cdp { constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); }
	static async connect(t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }); return new Cdp(ws); }
	send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.p.set(id, { resolve: res, reject: rej })); }
	async eval(e) { const r = await this.send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result.value; } }

const ps = (cmd) => execFileSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const visibleWindows = () => ps(`Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'; Get-Process | Where-Object { $_.ProcessName -match 'electron' } | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ } | Sort-Object -Unique; 'FG=' + (Get-Process | Where-Object { $_.MainWindowHandle -eq [W.U]::GetForegroundWindow() } | Select-Object -First 1 -ExpandProperty ProcessName)`);
const cpu = () => ps(`(Get-Process electron | Measure-Object -Property CPU -Sum).Sum`);

const main = await Cdp.connect(await find("main"));
await main.eval("window.electronAPI.startCapture()"); main.ws.close();
await sleep(1800);
const region = await Cdp.connect(await find("screenshot-region"));
await sleep(800);
const mouse = (type, x, y, extra = {}) => region.send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
// 单击一个几乎盖满屏幕的窗口：先悬停让识别生效
await mouse("mouseMoved", 1700, 950);
await sleep(500);
await mouse("mousePressed", 1700, 950, { clickCount: 1 });
await mouse("mouseReleased", 1700, 950, { clickCount: 1 });
await sleep(400);
const sel = await region.eval("(() => { const el = document.querySelector('[data-selection]'); return el ? el.getAttribute('data-selection') : document.body.innerText.match(/\\d+ × \\d+/)?.[0]; })()");
console.log("选区：", sel);
await region.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", text: "s", windowsVirtualKeyCode: 83 });
await region.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
await sleep(200);
const t0 = Date.now();
await region.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await region.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
region.ws.close();
const panel = await Cdp.connect(await find("scroll-capture"));
console.log(`面板窗口出现：${Date.now() - t0}ms`);
const cpu0 = Number(cpu());
for (let i = 0; i < 8; i++) {
	await sleep(1000);
	const s = Date.now();
	const state = await panel.eval("window.electronAPI.getScrollState()");
	const latency = Date.now() - s;
	console.log(`t+${i + 1}s 状态=${state?.status} ${state?.height}px preview#${state?.previewId} 主进程往返 ${latency}ms CPU累计 ${(Number(cpu()) - cpu0).toFixed(1)}s`);
	if (i === 2) console.log("可见的 Electron 窗口：", visibleWindows().replace(/\r?\n/g, " | "));
}
await panel.eval("window.electronAPI.cancelScroll()");
console.log("已取消");
