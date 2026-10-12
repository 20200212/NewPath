import type { DetectedWindow, Point, Rect } from "./ipcTypes";

/** 窗口枚举脚本返回的一项：物理像素、全局屏幕坐标。 */
export interface RawWindow {
	x: number;
	y: number;
	width: number;
	height: number;
	title: string;
	/** 窗口编号：macOS 的 CGWindowID、Windows 的 HWND；Linux 没有。 */
	id?: number;
}

/** 裁剪到显示器之后小于这个尺寸（CSS 像素）的窗口不参与识别。 */
const MIN_VISIBLE_SIZE = 24;

/** 校验并解析脚本输出的 JSON；任何格式问题都按"没有窗口"处理。 */
export function parseRawWindows(json: string): RawWindow[] {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return [];
	}
	return normalizeRawWindows(data);
}

/** 校验已经解析好的窗口列表（截图进程的 windows 命令直接返回数组）。 */
export function normalizeRawWindows(data: unknown): RawWindow[] {
	if (!Array.isArray(data)) return [];
	const result: RawWindow[] = [];
	for (const item of data) {
		if (!item || typeof item !== "object") continue;
		const { x, y, width, height, title, id } = item as Record<string, unknown>;
		const numbers = [x, y, width, height];
		if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
		if ((width as number) <= 0 || (height as number) <= 0) continue;
		result.push({
			x: x as number,
			y: y as number,
			width: width as number,
			height: height as number,
			title: typeof title === "string" ? title : "",
			...(typeof id === "number" && Number.isInteger(id) && id > 0 ? { id } : {}),
		});
	}
	return result;
}

/**
 * 把物理像素的全局窗口矩形换算成选区窗口里的 CSS 像素：
 * 先转成 DIP（toDip 由主进程传入 screen.screenToDipRect），裁剪到显示器范围内，再减去显示器原点。
 * 保持输入顺序（Z 序从前往后）。
 */
export function toDisplayLocalWindows(
	windows: RawWindow[],
	displayBounds: Rect,
	toDip: (rect: Rect) => Rect,
): DetectedWindow[] {
	const result: DetectedWindow[] = [];
	for (const window of windows) {
		const dip = toDip({ x: window.x, y: window.y, width: window.width, height: window.height });
		const left = Math.max(dip.x, displayBounds.x);
		const top = Math.max(dip.y, displayBounds.y);
		const right = Math.min(dip.x + dip.width, displayBounds.x + displayBounds.width);
		const bottom = Math.min(dip.y + dip.height, displayBounds.y + displayBounds.height);
		if (right - left < MIN_VISIBLE_SIZE || bottom - top < MIN_VISIBLE_SIZE) continue;
		result.push({
			rect: {
				x: Math.round(left - displayBounds.x),
				y: Math.round(top - displayBounds.y),
				width: Math.round(right - left),
				height: Math.round(bottom - top),
			},
			title: window.title,
			...(window.id !== undefined ? { id: window.id } : {}),
		});
	}
	return result;
}

/** 把全局 DIP 坐标（如 screen.getCursorScreenPoint()）换算成选区窗口里的 CSS 像素。 */
export function toDisplayLocalPoint(point: Point, displayBounds: Rect): Point {
	return { x: point.x - displayBounds.x, y: point.y - displayBounds.y };
}
