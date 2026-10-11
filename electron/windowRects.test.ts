import { describe, expect, it } from "vitest";
import { parseRawWindows, toDisplayLocalWindows } from "./windowRects";

const identity = (rect: { x: number; y: number; width: number; height: number }) => rect;

describe("windowRects", () => {
	it("解析脚本输出并跳过非法项", () => {
		const json = JSON.stringify([
			{ x: 0, y: 0, width: 100, height: 80, title: "记事本" },
			{ x: "1", y: 0, width: 100, height: 80 },
			{ x: 0, y: 0, width: 0, height: 80 },
			{ x: 5, y: 6, width: 50, height: 60 },
		]);
		expect(parseRawWindows(json)).toEqual([
			{ x: 0, y: 0, width: 100, height: 80, title: "记事本" },
			{ x: 5, y: 6, width: 50, height: 60, title: "" },
		]);
		expect(parseRawWindows("not json")).toEqual([]);
		expect(parseRawWindows("{}")).toEqual([]);
	});

	it("裁剪到显示器并换算成显示器内坐标", () => {
		const display = { x: 1920, y: 0, width: 1280, height: 720 };
		const result = toDisplayLocalWindows(
			[
				{ x: 1900, y: -10, width: 400, height: 300, title: "跨屏" },
				{ x: 0, y: 0, width: 800, height: 600, title: "另一块屏幕" },
				{ x: 3190, y: 100, width: 100, height: 100, title: "只露出 10px" },
			],
			display,
			identity,
		);
		expect(result).toEqual([{ rect: { x: 0, y: 0, width: 380, height: 290 }, title: "跨屏" }]);
	});

	it("先按缩放比例转成 DIP，并保持 Z 序", () => {
		const toDip = (rect: { x: number; y: number; width: number; height: number }) => ({
			x: rect.x / 1.5,
			y: rect.y / 1.5,
			width: rect.width / 1.5,
			height: rect.height / 1.5,
		});
		const display = { x: 0, y: 0, width: 1707, height: 960 };
		const result = toDisplayLocalWindows(
			[
				{ x: 150, y: 150, width: 300, height: 300, title: "前" },
				{ x: 0, y: 0, width: 1500, height: 900, title: "后" },
			],
			display,
			toDip,
		);
		expect(result.map((item) => item.title)).toEqual(["前", "后"]);
		expect(result[0].rect).toEqual({ x: 100, y: 100, width: 200, height: 200 });
	});
});
