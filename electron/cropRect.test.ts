import { describe, expect, it } from "vitest";
import { toDevicePixelRect } from "./cropRect";

const image = { width: 3840, height: 2160 };

describe("toDevicePixelRect", () => {
	it("按缩放比例换算到物理像素", () => {
		expect(toDevicePixelRect({ x: 10, y: 20, width: 100, height: 50 }, 2, image)).toEqual({
			x: 20,
			y: 40,
			width: 200,
			height: 100,
		});
	});

	it("裁剪到位图范围内", () => {
		expect(toDevicePixelRect({ x: -10, y: 2000, width: 50, height: 500 }, 1, image)).toEqual({
			x: 0,
			y: 2000,
			width: 40,
			height: 160,
		});
	});

	it("拒绝空选区和非法数值", () => {
		expect(toDevicePixelRect({ x: 0, y: 0, width: 0, height: 10 }, 1, image)).toBeNull();
		expect(toDevicePixelRect({ x: Number.NaN, y: 0, width: 10, height: 10 }, 1, image)).toBeNull();
		expect(toDevicePixelRect({ x: 0, y: 0, width: 10, height: 10 }, 0, image)).toBeNull();
	});
});
