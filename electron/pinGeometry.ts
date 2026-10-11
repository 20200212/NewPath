import type { Rect } from "./ipcTypes";

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/** 钉图离工作区边缘的距离，以及同时打开多张时每张错开的距离。 */
const PIN_MARGIN = 24;
const PIN_CASCADE = 24;

/** 等比缩小到不超过 max；本来就放得下就保持原尺寸。 */
export function fitSize(size: Size, max: Size): Size {
	const ratio = Math.min(1, max.width / size.width, max.height / size.height);
	return {
		width: Math.max(1, Math.round(size.width * ratio)),
		height: Math.max(1, Math.round(size.height * ratio)),
	};
}

/**
 * 钉图窗口的初始位置和尺寸（DIP）。
 * origin 是截图选区在屏幕上的位置，钉图就出现在原处；没有时放在工作区右上角，按 slot 依次错开。
 */
export function initialPinBounds(size: Size, origin: Point | null, workArea: Rect, slot = 0): Rect {
	const fitted = fitSize(size, { width: workArea.width, height: workArea.height });
	const offset = (slot % 8) * PIN_CASCADE;
	const preferred = origin ?? {
		x: workArea.x + workArea.width - fitted.width - PIN_MARGIN - offset,
		y: workArea.y + PIN_MARGIN + offset,
	};
	return {
		x: Math.round(clamp(preferred.x, workArea.x, workArea.x + workArea.width - fitted.width)),
		y: Math.round(clamp(preferred.y, workArea.y, workArea.y + workArea.height - fitted.height)),
		...fitted,
	};
}

export interface PinZoomLimits {
	minWidth: number;
	maxWidth: number;
	maxHeight: number;
}

/** 以光标为锚点缩放钉图窗口，保持宽高比（aspect = 宽 / 高）。 */
export function zoomPinBounds(bounds: Rect, factor: number, anchor: Point, aspect: number, limits: PinZoomLimits): Rect {
	const maxWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth, limits.maxHeight * aspect));
	const width = clamp(bounds.width * factor, limits.minWidth, maxWidth);
	const height = width / aspect;
	const ratio = width / bounds.width;
	return {
		x: Math.round(anchor.x - (anchor.x - bounds.x) * ratio),
		y: Math.round(anchor.y - (anchor.y - bounds.y) * ratio),
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(height)),
	};
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), Math.max(min, max));
}
