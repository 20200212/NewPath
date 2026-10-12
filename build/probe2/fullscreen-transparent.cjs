// 验证：Windows 上透明无边框窗口恰好盖满整个显示器时会不会失去透明（变成黑块）。
const { app, BrowserWindow, screen } = require("electron");
const { execFileSync } = require("node:child_process");
const html = (color) => "data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;height:100vh;background:${color}"></body>`);
function shot(name) {
	execFileSync("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap 1920,1080; $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $s=New-Object System.Drawing.Bitmap($b,480,270); $s.Save('D:/githubxm/NewPath/build/probe2/${name}.png')`]);
}
app.whenReady().then(async () => {
	const d = screen.getPrimaryDisplay();
	const make = (bounds) => {
		const w = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: "#00000000", alwaysOnTop: true, focusable: false, skipTaskbar: true, hasShadow: false, show: false, webPreferences: { javascript: false } });
		w.setIgnoreMouseEvents(true);
		return w;
	};
	const full = make({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height });
	await full.loadURL(html("rgba(255,0,0,.25)"));
	full.showInactive();
	await new Promise((r) => setTimeout(r, 1200));
	shot("full");
	full.destroy();
	const smaller = make({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width - 1, height: d.bounds.height - 1 });
	await smaller.loadURL(html("rgba(0,0,255,.25)"));
	smaller.showInactive();
	await new Promise((r) => setTimeout(r, 1200));
	shot("smaller");
	smaller.destroy();
	app.quit();
});
