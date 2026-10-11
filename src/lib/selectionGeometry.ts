import type { Rect } from "../../electron/ipcTypes";

export type { Rect };

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/** 选区边框上的 8 个调整手柄。 */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 两点（任意方向拖拽）围成的矩形。 */
export function rectFromPoints(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

/** 与画布求交集：超出部分被裁掉。 */
export function intersectBounds(rect: Rect, bounds: Size): Rect {
	const left = Math.max(0, rect.x);
	const top = Math.max(0, rect.y);
	const right = Math.min(bounds.width, rect.x + rect.width);
	const bottom = Math.min(bounds.height, rect.y + rect.height);
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** 平移选区，尺寸不变，碰到边缘时停住。 */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
	return {
		...rect,
		x: Math.min(Math.max(0, rect.x + dx), Math.max(0, bounds.width - rect.width)),
		y: Math.min(Math.max(0, rect.y + dy), Math.max(0, bounds.height - rect.height)),
	};
}

/** 拖动手柄调整选区；拖过对边时自动翻转。 */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, bounds: Size): Rect {
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;
	if (handle.includes("w")) left += dx;
	if (handle.includes("e")) right += dx;
	if (handle.includes("n")) top += dy;
	if (handle.includes("s")) bottom += dy;
	return intersectBounds(rectFromPoints({ x: left, y: top }, { x: right, y: bottom }), bounds);
}

export function containsPoint(rect: Rect, point: Point): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}

/** 移动距离小于阈值视为单击而不是拖拽。 */
export function isClick(start: Point, end: Point, threshold = 3): boolean {
	return Math.abs(end.x - start.x) < threshold && Math.abs(end.y - start.y) < threshold;
}
