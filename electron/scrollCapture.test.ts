import { describe, expect, it } from "vitest";
import {
	SCROLL_MAX_HEIGHT,
	SCROLL_PANEL_SIZE,
	parseScrollProgress,
	placeScrollPanel,
	scrollPanelLayout,
	clampScrollPanelPosition,
	scrollMaxHeight,
	scrollRegionFromSelection,
	scrollRingLayout,
	supportsScrollCapture,
} from "./scrollCapture";

const display = { x: 0, y: 0, width: 1512, height: 982 };
const retina = { width: 3024, height: 1964 };

describe("滚动截图的选区", () => {
	it("把画面像素换算成显示器内和全局的点坐标", () => {
		expect(scrollRegionFromSelection({ x: 200, y: 300, width: 1001, height: 1200 }, retina, display)).toEqual({
			points: { x: 100, y: 150, width: 500.5, height: 600 },
			global: { x: 100, y: 150, width: 500.5, height: 600 },
			pixels: { width: 1001, height: 1200 },
		});
		const second = { x: 1512, y: -200, width: 1920, height: 1080 };
		expect(
			scrollRegionFromSelection({ x: 0, y: 0, width: 800, height: 600 }, { width: 1920, height: 1080 }, second)?.global,
		).toEqual({ x: 1512, y: -200, width: 800, height: 600 });
	});

	it("拒绝格式不对、超出画面和太小的选区", () => {
		for (const rect of [
			null,
			{ x: 0, y: 0, width: 100.5, height: 400 },
			{ x: -1, y: 0, width: 100, height: 400 },
			{ x: 3000, y: 0, width: 100, height: 400 },
			{ x: 0, y: 0, width: 20, height: 400 },
			{ x: 0, y: 0, width: 400, height: 30 },
		]) {
			expect(scrollRegionFromSelection(rect, retina, display)).toBeNull();
		}
	});

	it("长图不超出编辑器 canvas 的限制", () => {
		expect(scrollMaxHeight(1600)).toBe(SCROLL_MAX_HEIGHT);
		expect(scrollMaxHeight(10_000)).toBe(10_000);
	});
});

describe("滚动截图的进度面板", () => {
	const workArea = { x: 0, y: 33, width: 1512, height: 949 };

	it("右边有地方放右边，否则放左边", () => {
		expect(placeScrollPanel({ x: 200, y: 100, width: 600, height: 700 }, workArea)).toEqual({ x: 814, y: 100 });
		expect(placeScrollPanel({ x: 700, y: 100, width: 700, height: 700 }, workArea)).toEqual({
			x: 700 - 14 - SCROLL_PANEL_SIZE.width,
			y: 100,
		});
	});

	it("很宽的选区放在下面或上面", () => {
		expect(placeScrollPanel({ x: 100, y: 60, width: 1300, height: 400 }, workArea)).toEqual({
			x: 1400 - SCROLL_PANEL_SIZE.width,
			y: 474,
		});
		expect(placeScrollPanel({ x: 100, y: 560, width: 1300, height: 400 }, workArea)).toEqual({
			x: 1400 - SCROLL_PANEL_SIZE.width,
			y: 560 - 14 - SCROLL_PANEL_SIZE.height,
		});
	});

	it("选区占满屏幕时放在屏幕角落", () => {
		expect(placeScrollPanel({ x: 0, y: 0, width: 1512, height: 982 }, workArea)).toEqual({
			x: 1504 - SCROLL_PANEL_SIZE.width,
			y: 974 - SCROLL_PANEL_SIZE.height,
		});
	});

	it("选区贴近顶部时面板不超出屏幕", () => {
		expect(placeScrollPanel({ x: 100, y: 0, width: 500, height: 300 }, workArea).y).toBe(41);
	});

	it("优先放到相邻的空闲显示器上", () => {
		const bounds = scrollPanelLayout(display, [workArea, { x: -1280, y: 0, width: 1280, height: 800 }]);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(0);
		expect(bounds.width).toBe(SCROLL_PANEL_SIZE.width);
	});

	it("显示器之间有空隙时面板放在目标显示器内", () => {
		const other = { x: 2000, y: -100, width: 1280, height: 800 };
		const bounds = scrollPanelLayout(display, [workArea, other]);
		expect(bounds.x).toBeGreaterThanOrEqual(other.x + 8);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(other.x + other.width - 8);
	});

	it("空位不够时先换小面板，避免挡住选区", () => {
		const area = { x: 0, y: 0, width: 900, height: 700 };
		const bounds = scrollPanelLayout(area, [{ x: 0, y: 0, width: 1160, height: 800 }]);
		expect(bounds.x).toBeGreaterThanOrEqual(area.width);
		expect(bounds.width).toBe(220);
	});

	it("完全没有空位时尽量少挡选区", () => {
		const bounds = scrollPanelLayout(display, [workArea]);
		expect(bounds.width).toBe(220);
		expect(bounds.height).toBe(300);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.width);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
	});

	it("负坐标的显示器上面板也在可见范围内", () => {
		const destination = { x: -1280, y: -200, width: 1280, height: 800 };
		expect(clampScrollPanelPosition({ x: -3000, y: 900 }, SCROLL_PANEL_SIZE, destination)).toEqual({ x: -1272, y: 172 });
	});
});

describe("滚动截图的边框", () => {
	it("画在选区外面一点", () => {
		expect(scrollRingLayout({ x: 100, y: 150, width: 500.5, height: 600 }, display)).toEqual({
			window: { x: 94, y: 144, width: 513, height: 612 },
			ring: { x: 2, y: 2, width: 509, height: 608 },
		});
	});

	it("碰到显示器边缘时收进来", () => {
		expect(scrollRingLayout({ x: 0, y: 0, width: 1512, height: 982 }, display)).toEqual({
			window: { x: 0, y: 0, width: 1512, height: 982 },
			ring: { x: 0, y: 0, width: 1512, height: 982 },
		});
	});
});

describe("滚动截图的进度", () => {
	it("解析截图进程的 scroll 事件", () => {
		expect(parseScrollProgress({ event: "scroll", status: "capturing", height: 4210, width: 1600, preview: 3 })).toEqual({
			status: "capturing",
			height: 4210,
			width: 1600,
			preview: 3,
		});
		expect(parseScrollProgress({ event: "stopped" })).toBeNull();
		expect(parseScrollProgress({ event: "scroll", status: "finishing", height: 1, width: 1, preview: 0 })).toBeNull();
		expect(parseScrollProgress({ event: "scroll", status: "lost", height: -1, width: 1, preview: 0 })).toBeNull();
	});
});

describe("滚动截图的系统要求", () => {
	it("只在 macOS 14 起可用", () => {
		expect(supportsScrollCapture("darwin", "14.0.0")).toBe(true);
		expect(supportsScrollCapture("darwin", "26.6.2")).toBe(true);
		expect(supportsScrollCapture("darwin", "13.6.1")).toBe(false);
		expect(supportsScrollCapture("win32", "10.0.22631")).toBe(false);
	});
});
