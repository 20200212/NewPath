import type { Rect } from "./ipcTypes";

// macOS 上用 /usr/sbin/screencapture 截图时用到的纯函数。
// 移植自 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）的 electron/windowCapture.ts。

/** 单独截一个窗口（CGWindowID），不带阴影、不发出快门声。 */
export function windowCaptureArguments(windowId: number, filePath: string) {
	return ["-l", String(windowId), "-o", "-x", "-t", "png", filePath];
}

/** 截取一块显示器区域（全局点坐标）。 */
export function regionCaptureArguments(bounds: Rect, filePath: string) {
	return ["-x", "-t", "png", "-R", `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`, filePath];
}

/** 系统自带的框选（和 ⌘⇧4 一样），不带窗口阴影、不发出快门声。 */
export function interactiveCaptureArguments(filePath: string) {
	return ["-i", "-o", "-x", "-t", "png", filePath];
}

/**
 * 每像素 4 字节、alpha 在最后（BGRA 或 RGBA）的位图里，不透明度高于 threshold 的像素所占的最小矩形。
 * 有些应用把窗口画在更大的透明框里，裁掉之后只剩窗口本身。全透明时返回 null。
 */
export function findOpaqueBounds(bitmap: Uint8Array, width: number, height: number, threshold = 8): Rect | null {
	if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return null;
	const opaque = (x: number, y: number) => bitmap[(y * width + x) * 4 + 3] > threshold;
	const rowHasPixel = (y: number) => {
		for (let x = 0; x < width; x += 1) if (opaque(x, y)) return true;
		return false;
	};
	let top = 0;
	while (top < height && !rowHasPixel(top)) top += 1;
	if (top === height) return null;
	let bottom = height - 1;
	while (bottom > top && !rowHasPixel(bottom)) bottom -= 1;
	const columnHasPixel = (x: number) => {
		for (let y = top; y <= bottom; y += 1) if (opaque(x, y)) return true;
		return false;
	};
	let left = 0;
	while (left < width && !columnHasPixel(left)) left += 1;
	let right = width - 1;
	while (right > left && !columnHasPixel(right)) right -= 1;
	return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
