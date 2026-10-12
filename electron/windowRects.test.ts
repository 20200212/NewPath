import { describe, expect, it } from "vitest";
import { normalizeRawWindows, parseRawWindows, toDisplayLocalPoint, toDisplayLocalWindows } from "./windowRects";

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

	it("保留 macOS 的窗口编号，丢掉不合法的编号", () => {
		expect(
			normalizeRawWindows([
				{ id: 4821, x: 0, y: 0, width: 100, height: 80, title: "访达" },
				{ id: 1.5, x: 0, y: 0, width: 100, height: 80, title: "小数" },
				{ id: "7", x: 0, y: 0, width: 100, height: 80, title: "字符串" },
			]).map((window) => window.id),
		).toEqual([4821, undefined, undefined]);
		const [local] = toDisplayLocalWindows(
			[{ id: 4821, x: 10, y: 10, width: 100, height: 80, title: "访达" }],
			{ x: 0, y: 0, width: 1440, height: 900 },
			identity,
		);
		expect(local).toEqual({ id: 4821, title: "访达", rect: { x: 10, y: 10, width: 100, height: 80 } });
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

	it("光标位置换算成显示器内坐标", () => {
		expect(toDisplayLocalPoint({ x: 2000, y: 300 }, { x: 1920, y: 0, width: 1280, height: 720 })).toEqual({ x: 80, y: 300 });
		expect(toDisplayLocalPoint({ x: -100, y: -50 }, { x: -1280, y: -720, width: 1280, height: 720 })).toEqual({
			x: 1180,
			y: 670,
		});
	});
});
