import type { Rect } from "./ipcTypes";

/**
 * 把渲染进程给出的 CSS 像素选区换算成截图位图上的物理像素区域，
 * 并裁剪到位图范围内。返回 null 表示选区为空或数据非法。
 */
export function toDevicePixelRect(
	rect: Rect,
	scaleFactor: number,
	imageSize: { width: number; height: number },
): Rect | null {
	const values = [rect.x, rect.y, rect.width, rect.height, scaleFactor];
	if (!values.every(Number.isFinite) || scaleFactor <= 0) return null;

	const left = Math.max(0, Math.round(rect.x * scaleFactor));
	const top = Math.max(0, Math.round(rect.y * scaleFactor));
	const right = Math.min(imageSize.width, Math.round((rect.x + rect.width) * scaleFactor));
	const bottom = Math.min(imageSize.height, Math.round((rect.y + rect.height) * scaleFactor));
	if (right - left < 1 || bottom - top < 1) return null;

	return { x: left, y: top, width: right - left, height: bottom - top };
}
