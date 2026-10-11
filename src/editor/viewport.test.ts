import { describe, expect, it } from "vitest";
import {
	clampPan,
	fitZoom,
	formatZoom,
	imageOrigin,
	MAX_ZOOM,
	normalizeWheelDelta,
	parseZoomInput,
	wheelZoomFactor,
	zoomAround,
} from "./viewport";

const viewport = { width: 1000, height: 800 };
const insets = { top: 50, right: 50, bottom: 50, left: 50 };

describe("viewport", () => {
	it("适应窗口：缩小到能完整显示，但不超过 100%", () => {
		expect(fitZoom({ width: 1800, height: 700 }, viewport, insets, 1)).toBeCloseTo(0.5);
		expect(fitZoom({ width: 200, height: 100 }, viewport, insets, 1)).toBe(1);
		// 2x 截图：图片像素是逻辑尺寸的两倍
		expect(fitZoom({ width: 1800, height: 700 }, viewport, insets, 2)).toBe(1);
	});

	it("图比可用区域小时居中，大时限制在边缘", () => {
		expect(clampPan({ x: 100, y: -50 }, { width: 400, height: 300 }, 1, viewport, insets)).toEqual({ x: 0, y: 0 });
		expect(clampPan({ x: 1000, y: -1000 }, { width: 1100, height: 900 }, 1, viewport, insets)).toEqual({ x: 100, y: -100 });
	});

	it("以光标为中心缩放：光标下的像素位置不变", () => {
		const image = { width: 400, height: 300 };
		const center = { x: 500, y: 400 };
		const anchor = { x: 300, y: 250 };
		const before = imageOrigin(image, 1, { x: 0, y: 0 }, viewport, insets);
		const pixel = { x: anchor.x - before.x, y: anchor.y - before.y };
		const pan = zoomAround({ x: 0, y: 0 }, 1, 2, anchor, center);
		const after = imageOrigin(image, 2, pan, viewport, insets);
		expect(anchor.x - after.x).toBeCloseTo(pixel.x * 2);
		expect(anchor.y - after.y).toBeCloseTo(pixel.y * 2);
	});

	it("滚轮倍数和单位换算", () => {
		expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
		expect(wheelZoomFactor(100, false)).toBeLessThan(1);
		expect(wheelZoomFactor(10000, true)).toBeCloseTo(Math.exp(-1.5));
		expect(normalizeWheelDelta(3, 1, 600)).toBe(48);
		expect(normalizeWheelDelta(1, 2, 600)).toBe(600);
	});

	it("百分比输入的解析和显示", () => {
		expect(parseZoomInput("150")).toBe(1.5);
		expect(parseZoomInput(" 50% ")).toBe(0.5);
		expect(parseZoomInput("99999")).toBe(MAX_ZOOM);
		expect(parseZoomInput("abc")).toBeNull();
		expect(parseZoomInput("")).toBeNull();
		expect(formatZoom(0.33333)).toBe("33.3");
	});
});
