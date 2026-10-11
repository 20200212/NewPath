import type { DetectedWindow } from "../../electron/ipcTypes";

/** 纯浏览器调试（npm run dev:ui）时没有真实截图，用渐变图代替。 */
export function createMockScreenshot(width: number, height: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d")!;
	const gradient = ctx.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, "#1e3a8a");
	gradient.addColorStop(1, "#9d174d");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.font = `${Math.round(height / 12)}px sans-serif`;
	ctx.textAlign = "center";
	ctx.fillText("Mock Screenshot", width / 2, height / 2);
	return canvas.toDataURL("image/png");
}

/** dev:ui 下模拟几个窗口，用来调试悬停识别。按 Z 序从前往后。 */
export function createMockWindows(width: number, height: number): DetectedWindow[] {
	return [
		{ title: "记事本", rect: { x: Math.round(width * 0.55), y: Math.round(height * 0.2), width: 360, height: 260 } },
		{ title: "浏览器", rect: { x: Math.round(width * 0.1), y: Math.round(height * 0.12), width: Math.round(width * 0.6), height: Math.round(height * 0.65) } },
		{ title: "桌面应用", rect: { x: 0, y: 0, width, height: height - 48 } },
	];
}
