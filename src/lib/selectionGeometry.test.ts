import { describe, expect, it } from "vitest";
import { containsPoint, findWindowAt, isClick, moveRect, rectFromPoints, resizeRect } from "./selectionGeometry";

const bounds = { width: 1920, height: 1080 };

describe("selectionGeometry", () => {
	it("任意方向拖拽都得到正向矩形", () => {
		expect(rectFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 })).toEqual({
			x: 100,
			y: 50,
			width: 200,
			height: 150,
		});
	});

	it("平移时保持尺寸并停在边缘", () => {
		const rect = { x: 1800, y: 10, width: 100, height: 100 };
		expect(moveRect(rect, 500, -500, bounds)).toEqual({ x: 1820, y: 0, width: 100, height: 100 });
	});

	it("调整手柄越过对边时翻转", () => {
		const rect = { x: 100, y: 100, width: 100, height: 100 };
		expect(resizeRect(rect, "e", -150, 0, bounds)).toEqual({ x: 50, y: 100, width: 50, height: 100 });
		expect(resizeRect(rect, "nw", -200, -200, bounds)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
	});

	it("判断点击和包含关系", () => {
		expect(isClick({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(true);
		expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
		expect(containsPoint({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 })).toBe(true);
	});

	it("按 Z 序找出光标下最上层的窗口", () => {
		const windows = [
			{ title: "前", rect: { x: 100, y: 100, width: 200, height: 200 } },
			{ title: "后", rect: { x: 0, y: 0, width: 1000, height: 800 } },
		];
		expect(findWindowAt(windows, { x: 150, y: 150 })?.title).toBe("前");
		expect(findWindowAt(windows, { x: 50, y: 50 })?.title).toBe("后");
		// 右边界和下边界不算在内
		expect(findWindowAt(windows, { x: 300, y: 150 })?.title).toBe("后");
		expect(findWindowAt(windows, { x: 1000, y: 10 })).toBeNull();
	});
});
