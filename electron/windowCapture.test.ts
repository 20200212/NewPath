import { describe, expect, it } from "vitest";
import { findOpaqueBounds, interactiveCaptureArguments, regionCaptureArguments, windowCaptureArguments } from "./windowCapture";

function bitmap(width: number, height: number, opaque: (x: number, y: number) => number) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) data[(y * width + x) * 4 + 3] = opaque(x, y);
	}
	return data;
}

describe("findOpaqueBounds", () => {
	it("裁掉窗口外面的透明框", () => {
		const data = bitmap(20, 12, (x, y) => (x >= 3 && x < 17 && y >= 2 && y < 10 ? 255 : 0));
		expect(findOpaqueBounds(data, 20, 12)).toEqual({ x: 3, y: 2, width: 14, height: 8 });
	});

	it("圆角窗口的四角仍在范围内", () => {
		// 只有四条边的中点不透明，相当于圆角很大的窗口
		const data = bitmap(10, 10, (x, y) =>
			(x === 0 && y === 5) || (x === 9 && y === 4) || (y === 0 && x === 5) || (y === 9 && x === 5) ? 255 : 0,
		);
		expect(findOpaqueBounds(data, 10, 10)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
	});

	it("忽略低于阈值的残留像素", () => {
		const data = bitmap(8, 8, (x, y) => (x === 0 ? 5 : x >= 2 && x < 6 && y >= 2 && y < 6 ? 200 : 0));
		expect(findOpaqueBounds(data, 8, 8)).toEqual({ x: 2, y: 2, width: 4, height: 4 });
	});

	it("全透明或位图长度不对时返回 null", () => {
		expect(findOpaqueBounds(bitmap(4, 4, () => 0), 4, 4)).toBeNull();
		expect(findOpaqueBounds(new Uint8Array(3), 4, 4)).toBeNull();
	});
});

describe("screencapture 参数", () => {
	it("单独截一个窗口，不带阴影、没有声音", () => {
		expect(windowCaptureArguments(4821, "/tmp/w.png")).toEqual(["-l", "4821", "-o", "-x", "-t", "png", "/tmp/w.png"]);
	});

	it("按全局点坐标截一块区域", () => {
		expect(regionCaptureArguments({ x: -1440, y: 0, width: 1440, height: 900 }, "/tmp/d.png")).toEqual([
			"-x",
			"-t",
			"png",
			"-R",
			"-1440,0,1440,900",
			"/tmp/d.png",
		]);
	});

	it("系统框选", () => {
		expect(interactiveCaptureArguments("/tmp/s.png")).toEqual(["-i", "-o", "-x", "-t", "png", "/tmp/s.png"]);
	});
});
