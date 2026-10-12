import type { AgentEvent } from "./captureAgent";
import type { Rect, ScrollStatus } from "./ipcTypes";

// 滚动截图（macOS 14 起、Windows 10 起）用到的纯函数。截图进程 / 助手负责连续截取选区并拼接，
// 主进程在选区旁边放一个进度面板、四周画一圈彩色边框，完成后把长图交给编辑器。
// 移植自 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）的 electron/scrollCapture.ts。

/** 长图的最大高度，保证编辑器的 canvas 不超出 Chromium 的限制。 */
export const SCROLL_MAX_HEIGHT = 30_000;
const SCROLL_MAX_PIXELS = 100_000_000;
/** 小于这个尺寸（像素）的选区不值得滚动截图。 */
const SCROLL_MIN_SIZE = { width: 48, height: 64 };
export const SCROLL_PANEL_SIZE = { width: 260, height: 420 };
export const SCROLL_PANEL_COMPACT_SIZE = { width: 220, height: 300 };
/** 边框窗口比选区向外多出的距离（点）。 */
export const SCROLL_RING_OUTSET = 6;
const EDGE_MARGIN = 8;

/** 截图进程上报的进度；finishing 是主进程自己的状态，截图进程不会发。 */
export interface ScrollProgress {
	status: ScrollStatus;
	/** 现在结束的话长图的尺寸（像素）。 */
	height: number;
	width: number;
	/** 截图进程每重写一次预览图就加一。 */
	preview: number;
}

const AGENT_STATUSES = new Set<ScrollStatus>(["waiting", "capturing", "behind", "lost", "full", "error"]);

export function scrollMaxHeight(width: number) {
	return Math.max(1, Math.min(SCROLL_MAX_HEIGHT, Math.floor(SCROLL_MAX_PIXELS / Math.max(1, width))));
}

/**
 * 把选区（截图画面里的像素）换算成截图进程要的参数：相对显示器的点坐标、全局点坐标，以及每一帧的像素尺寸。
 * 格式不对或太小时返回 null。
 */
export function scrollRegionFromSelection(
	rect: unknown,
	frame: { width: number; height: number },
	displayBounds: Rect,
): { points: Rect; global: Rect; pixels: { width: number; height: number } } | null {
	if (!rect || typeof rect !== "object") return null;
	const { x, y, width, height } = rect as Record<string, unknown>;
	if (
		![x, y, width, height].every((value) => Number.isInteger(value)) ||
		frame.width <= 0 ||
		frame.height <= 0 ||
		displayBounds.width <= 0 ||
		displayBounds.height <= 0
	) {
		return null;
	}
	const pixels = { x: x as number, y: y as number, width: width as number, height: height as number };
	if (
		pixels.x < 0 ||
		pixels.y < 0 ||
		pixels.width < SCROLL_MIN_SIZE.width ||
		pixels.height < SCROLL_MIN_SIZE.height ||
		pixels.x + pixels.width > frame.width ||
		pixels.y + pixels.height > frame.height
	) {
		return null;
	}
	const scaleX = frame.width / displayBounds.width;
	const scaleY = frame.height / displayBounds.height;
	const points = {
		x: pixels.x / scaleX,
		y: pixels.y / scaleY,
		width: pixels.width / scaleX,
		height: pixels.height / scaleY,
	};
	return {
		points,
		global: { ...points, x: displayBounds.x + points.x, y: displayBounds.y + points.y },
		pixels: { width: pixels.width, height: pixels.height },
	};
}

function clamp(value: number, low: number, high: number) {
	return Math.min(Math.max(value, low), Math.max(low, high));
}

/** 面板放在哪：右边或左边有地方就放旁边，否则放下面或上面；四周都没地方时，放在和选区重叠最少的屏幕角落。 */
export function placeScrollPanel(
	area: Rect,
	workArea: Rect,
	size: { width: number; height: number } = SCROLL_PANEL_SIZE,
	gap = 14,
): { x: number; y: number } {
	const left = workArea.x + EDGE_MARGIN;
	const top = workArea.y + EDGE_MARGIN;
	const right = workArea.x + workArea.width - EDGE_MARGIN;
	const bottom = workArea.y + workArea.height - EDGE_MARGIN;
	const besideY = clamp(area.y, top, bottom - size.height);
	const alignedX = clamp(area.x + area.width - size.width, left, right - size.width);
	let position: { x: number; y: number };
	if (area.x + area.width + gap + size.width <= right) {
		position = { x: area.x + area.width + gap, y: besideY };
	} else if (area.x - gap - size.width >= left) {
		position = { x: area.x - gap - size.width, y: besideY };
	} else if (area.y + area.height + gap + size.height <= bottom) {
		position = { x: alignedX, y: area.y + area.height + gap };
	} else if (area.y - gap - size.height >= top) {
		position = { x: alignedX, y: area.y - gap - size.height };
	} else {
		const candidates = [
			{ x: right - size.width, y: bottom - size.height },
			{ x: right - size.width, y: top },
			{ x: left, y: bottom - size.height },
			{ x: left, y: top },
		];
		position = candidates.reduce((best, candidate) =>
			panelOverlap(candidate, size, area) < panelOverlap(best, size, area) ? candidate : best,
		);
	}
	return clampScrollPanelPosition(position, size, workArea);
}

function panelOverlap(position: { x: number; y: number }, size: { width: number; height: number }, area: Rect) {
	const overlap = intersect({ ...position, ...size }, area);
	return overlap.width * overlap.height;
}

/** 优先把完整的面板放在选区外面（包括相邻的显示器）；实在没有空位，换小一号的面板，少挡一点选区。 */
export function scrollPanelLayout(area: Rect, workAreas: readonly Rect[]): Rect {
	const areas = workAreas.length ? workAreas : [area];
	let best: Rect | null = null;
	let bestOverlap = Infinity;
	for (const preferred of [SCROLL_PANEL_SIZE, SCROLL_PANEL_COMPACT_SIZE]) {
		for (const workArea of areas) {
			const size = {
				width: Math.max(1, Math.min(preferred.width, workArea.width - EDGE_MARGIN * 2)),
				height: Math.max(1, Math.min(preferred.height, workArea.height - EDGE_MARGIN * 2)),
			};
			const position = placeScrollPanel(area, workArea, size);
			const overlap = panelOverlap(position, size, area);
			const bounds = { ...position, ...size };
			if (overlap === 0) return bounds;
			if (overlap < bestOverlap) {
				best = bounds;
				bestOverlap = overlap;
			}
		}
	}
	return best ?? { ...area, ...SCROLL_PANEL_COMPACT_SIZE };
}

/** 面板的初始位置限制在目标显示器的工作区内。 */
export function clampScrollPanelPosition(
	position: { x: number; y: number },
	size: { width: number; height: number },
	workArea: Rect,
) {
	return {
		x: Math.round(
			clamp(position.x, workArea.x + EDGE_MARGIN, workArea.x + Math.max(EDGE_MARGIN, workArea.width - size.width - EDGE_MARGIN)),
		),
		y: Math.round(
			clamp(position.y, workArea.y + EDGE_MARGIN, workArea.y + Math.max(EDGE_MARGIN, workArea.height - size.height - EDGE_MARGIN)),
		),
	};
}

function intersect(a: Rect, b: Rect): Rect {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
		height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
	};
}

/**
 * 边框窗口的位置，以及边框在窗口里的位置：画在选区外面一点，碰到显示器边缘时收进来。
 * 截图进程会排除 NewPath 自己的窗口，所以边框不会出现在长图里。
 */
export function scrollRingLayout(area: Rect, display: Rect, outset = SCROLL_RING_OUTSET) {
	const grown = { x: area.x - outset, y: area.y - outset, width: area.width + outset * 2, height: area.height + outset * 2 };
	const outer = intersect(grown, display);
	const window = {
		x: Math.floor(outer.x),
		y: Math.floor(outer.y),
		width: Math.max(1, Math.ceil(outer.x + outer.width) - Math.floor(outer.x)),
		height: Math.max(1, Math.ceil(outer.y + outer.height) - Math.floor(outer.y)),
	};
	const ringOutset = Math.max(0, outset - 2);
	const ring = intersect(
		{
			x: area.x - ringOutset,
			y: area.y - ringOutset,
			width: area.width + ringOutset * 2,
			height: area.height + ringOutset * 2,
		},
		window,
	);
	return {
		window,
		ring: {
			x: Math.round(ring.x - window.x),
			y: Math.round(ring.y - window.y),
			width: Math.round(ring.width),
			height: Math.round(ring.height),
		},
	};
}

/** 解析截图进程的 {"event":"scroll"} 事件；其他内容返回 null。 */
export function parseScrollProgress(event: AgentEvent): ScrollProgress | null {
	if (event.event !== "scroll") return null;
	const { status, height, width, preview } = event;
	if (typeof status !== "string" || !AGENT_STATUSES.has(status as ScrollStatus)) return null;
	if (![height, width, preview].every((value) => Number.isInteger(value) && (value as number) >= 0)) return null;
	return {
		status: status as ScrollStatus,
		height: height as number,
		width: width as number,
		preview: preview as number,
	};
}

/**
 * 滚动截图在 macOS 14 起（ScreenCaptureKit 的截图接口）和 Windows 10 起（助手进程用 GDI 连续截屏）可用；
 * systemVersion 形如 "14.5.0" 或 "10.0.19045"。
 */
export function supportsScrollCapture(platform: string, systemVersion: string) {
	const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
	if (platform === "darwin") return major >= 14;
	if (platform === "win32") return major >= 10;
	return false;
}

/** Windows 10 2004（build 19041）起窗口可以从屏幕采集里排除（WDA_EXCLUDEFROMCAPTURE），更老的系统会变成黑块。 */
export function supportsCaptureExclusion(platform: string, systemVersion: string) {
	if (platform !== "win32") return false;
	const [major, , build] = systemVersion.split(".").map((part) => Number.parseInt(part, 10));
	return major > 10 || (major === 10 && (build ?? 0) >= 19041);
}
