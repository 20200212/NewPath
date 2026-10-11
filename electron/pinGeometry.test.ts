import { describe, expect, it } from "vitest";
import { fitSize, initialPinBounds, zoomPinBounds } from "./pinGeometry";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("pinGeometry", () => {
	it("只缩小不放大，保持比例", () => {
		expect(fitSize({ width: 400, height: 300 }, { width: 1000, height: 1000 })).toEqual({ width: 400, height: 300 });
		expect(fitSize({ width: 4000, height: 1000 }, { width: 2000, height: 2000 })).toEqual({ width: 2000, height: 500 });
	});

	it("有选区位置时出现在原处，并限制在工作区内", () => {
		expect(initialPinBounds({ width: 300, height: 200 }, { x: 100, y: 50 }, workArea)).toEqual({
			x: 100,
			y: 50,
			width: 300,
			height: 200,
		});
		expect(initialPinBounds({ width: 300, height: 200 }, { x: 1800, y: 1000 }, workArea)).toEqual({
			x: 1620,
			y: 840,
			width: 300,
			height: 200,
		});
	});

	it("没有位置时放在右上角，多张依次错开", () => {
		const first = initialPinBounds({ width: 300, height: 200 }, null, workArea, 0);
		const second = initialPinBounds({ width: 300, height: 200 }, null, workArea, 1);
		expect(first).toEqual({ x: 1596, y: 24, width: 300, height: 200 });
		expect(second.x).toBe(first.x - 24);
		expect(second.y).toBe(first.y + 24);
	});

	it("以光标为锚点缩放，保持宽高比", () => {
		const bounds = { x: 100, y: 100, width: 200, height: 100 };
		const limits = { minWidth: 80, maxWidth: 1920, maxHeight: 1040 };
		expect(zoomPinBounds(bounds, 2, { x: 100, y: 100 }, 2, limits)).toEqual({ x: 100, y: 100, width: 400, height: 200 });
		expect(zoomPinBounds(bounds, 2, { x: 300, y: 200 }, 2, limits)).toEqual({ x: -100, y: 0, width: 400, height: 200 });
	});

	it("缩放受最小宽度和最大高度限制", () => {
		const bounds = { x: 0, y: 0, width: 200, height: 100 };
		const limits = { minWidth: 80, maxWidth: 1920, maxHeight: 300 };
		expect(zoomPinBounds(bounds, 0.1, { x: 0, y: 0 }, 2, limits).width).toBe(80);
		expect(zoomPinBounds(bounds, 10, { x: 0, y: 0 }, 2, limits)).toEqual({ x: 0, y: 0, width: 600, height: 300 });
	});
});
