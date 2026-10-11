import type { Point, Size } from "./types";

/**
 * 缩放比例 zoom = 每个"逻辑像素"占多少 CSS 像素，100% 表示和截图时在屏幕上看到的一样大。
 * 内部绘制用的 scale = 每个图片像素占多少 CSS 像素 = zoom / unit（unit 为截图的缩放比例）。
 */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

/** 画布四周留给浮动工具条的空间。 */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function availableSize(viewport: Size, insets: Insets): Size {
	return {
		width: Math.max(1, viewport.width - insets.left - insets.right),
		height: Math.max(1, viewport.height - insets.top - insets.bottom),
	};
}

/** 适应窗口：完整显示图片，但不会放大到超过 100%。 */
export function fitZoom(image: Size, viewport: Size, insets: Insets, unit: number): number {
	if (image.width <= 0 || image.height <= 0) return 1;
	const area = availableSize(viewport, insets);
	return clampZoom(Math.min((area.width / image.width) * unit, (area.height / image.height) * unit, 1));
}

/** 平移限位：图片比可用区域小时居中，大时最多平移到图片边缘贴住可用区域边缘。 */
export function clampPan(pan: Point, image: Size, scale: number, viewport: Size, insets: Insets): Point {
	const area = availableSize(viewport, insets);
	const clampAxis = (value: number, content: number, available: number) => {
		const limit = (content - available) / 2;
		return limit <= 0 ? 0 : Math.min(limit, Math.max(-limit, value));
	};
	return {
		x: clampAxis(pan.x, image.width * scale, area.width),
		y: clampAxis(pan.y, image.height * scale, area.height),
	};
}

/** 可用区域的中心（视口内 CSS 像素），pan 就是图片中心相对这里的偏移。 */
export function viewCenter(viewport: Size, insets: Insets): Point {
	const area = availableSize(viewport, insets);
	return { x: insets.left + area.width / 2, y: insets.top + area.height / 2 };
}

/** 以 anchor（视口内坐标）为中心从 scale 缩放到 nextScale，保持光标下的像素不动。 */
export function zoomAround(pan: Point, scale: number, nextScale: number, anchor: Point, center: Point): Point {
	const ratio = nextScale / scale;
	const ax = anchor.x - center.x;
	const ay = anchor.y - center.y;
	return { x: ax - (ax - pan.x) * ratio, y: ay - (ay - pan.y) * ratio };
}

/** 图片左上角在视口里的位置。 */
export function imageOrigin(image: Size, scale: number, pan: Point, viewport: Size, insets: Insets): Point {
	const center = viewCenter(viewport, insets);
	return { x: center.x + pan.x - (image.width * scale) / 2, y: center.y + pan.y - (image.height * scale) / 2 };
}

/** 滚轮一次的缩放倍数：Ctrl / 触控板捏合时更快。 */
export function wheelZoomFactor(deltaY: number, fast: boolean): number {
	const clamped = Math.min(300, Math.max(-300, deltaY));
	return Math.exp(-clamped * (fast ? 0.005 : 0.002));
}

/** WheelEvent.deltaMode：0 像素，1 行，2 页。统一换算成像素。 */
export function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
	if (deltaMode === 1) return delta * 16;
	if (deltaMode === 2) return delta * pageSize;
	return delta;
}

/** 百分比输入框里显示的数字，保留一位小数。 */
export function formatZoom(zoom: number): string {
	return String(Math.round(zoom * 1000) / 10);
}

/** 解析输入框内容，接受 "150" 或 "150%"；非法输入返回 null。 */
export function parseZoomInput(text: string): number | null {
	const value = Number(text.trim().replace(/%$/, ""));
	if (!text.trim() || !Number.isFinite(value) || value <= 0) return null;
	return clampZoom(value / 100);
}
