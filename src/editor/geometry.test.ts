import { describe, expect, it } from "vitest";
import {
	boxFromPoints,
	getHandles,
	getVisualBounds,
	hitHandle,
	hitTest,
	isDegenerate,
	moveAnnotation,
	nextCounterValue,
	pickAnnotation,
	resizeAnnotation,
	simplifyPath,
	snap45,
} from "./geometry";
import type { Annotation, BoxAnnotation, PathAnnotation, TextAnnotation } from "./types";

const rect = (id: string, x: number, y: number, w: number, h: number, fill: BoxAnnotation["fill"] = "none"): BoxAnnotation => ({
	id,
	kind: "rect",
	x,
	y,
	w,
	h,
	color: "#FF3B30",
	width: 4,
	fill,
});

describe("geometry", () => {
	it("拖拽得到正向矩形，Shift 取正方形", () => {
		expect(boxFromPoints({ x: 100, y: 100 }, { x: 40, y: 70 })).toEqual({ x: 40, y: 70, w: 60, h: 30 });
		expect(boxFromPoints({ x: 0, y: 0 }, { x: -30, y: 10 }, true)).toEqual({ x: -30, y: 0, w: 30, h: 30 });
	});

	it("矩形命中：描边、内部（弱命中）、外部", () => {
		const shape = rect("a", 0, 0, 100, 100);
		expect(hitTest(shape, { x: 1, y: 50 }, 3)).toBe("stroke");
		expect(hitTest(shape, { x: 50, y: 50 }, 3)).toBe("inside");
		expect(hitTest(rect("b", 0, 0, 100, 100, "solid"), { x: 50, y: 50 }, 3)).toBe("body");
		expect(hitTest(shape, { x: 120, y: 50 }, 3)).toBeNull();
	});

	it("椭圆和线段命中", () => {
		const ellipse: Annotation = { ...rect("e", 0, 0, 200, 100), kind: "ellipse" };
		expect(hitTest(ellipse, { x: 100, y: 1 }, 3)).toBe("stroke");
		expect(hitTest(ellipse, { x: 100, y: 50 }, 3)).toBe("inside");
		expect(hitTest(ellipse, { x: 5, y: 5 }, 3)).toBeNull();
		const line: Annotation = { id: "l", kind: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, color: "#000000", width: 4 };
		expect(hitTest(line, { x: 50, y: 4 }, 3)).toBe("stroke");
		expect(hitTest(line, { x: 50, y: 10 }, 3)).toBeNull();
	});

	it("优先选最上层的实心命中，否则取最小的未填充形状", () => {
		const big = rect("big", 0, 0, 400, 400);
		const small = rect("small", 100, 100, 50, 50);
		const list = [small, big];
		expect(pickAnnotation(list, { x: 120, y: 120 }, 3, { allowInside: true })?.id).toBe("small");
		expect(pickAnnotation(list, { x: 120, y: 120 }, 3, { allowInside: false })).toBeNull();
		expect(pickAnnotation(list, { x: 1, y: 200 }, 3, { allowInside: false })?.id).toBe("big");
		expect(pickAnnotation(list, { x: 120, y: 120 }, 3, { allowInside: true, filter: (a) => a.id === "big" })?.id).toBe("big");
	});

	it("手柄：框有 8 个，文字只有 4 个角，线段两端", () => {
		expect(getHandles(rect("a", 0, 0, 10, 10))).toHaveLength(8);
		const text: TextAnnotation = { id: "t", kind: "text", x: 0, y: 0, w: 50, h: 20, text: "hi", color: "#000000", size: 16, style: "plain" };
		expect(getHandles(text).map((handle) => handle.id)).toEqual(["nw", "ne", "se", "sw"]);
		expect(hitHandle(rect("a", 0, 0, 100, 100), { x: 101, y: 99 }, 5)).toBe("se");
	});

	it("调整框：越过对边时翻转，Shift 保持比例", () => {
		const shape = rect("a", 0, 0, 100, 50);
		expect(resizeAnnotation(shape, "e", -150, 0, false)).toMatchObject({ x: -50, w: 50 });
		expect(resizeAnnotation(shape, "se", 100, 0, true)).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
		expect(resizeAnnotation(shape, "nw", -100, -10, true)).toMatchObject({ x: -100, y: -50, w: 200, h: 100 });
	});

	it("拖动文字的角按比例缩放字号，对角固定", () => {
		const text: TextAnnotation = { id: "t", kind: "text", x: 10, y: 10, w: 100, h: 40, text: "hi", color: "#000000", size: 20, style: "plain" };
		const result = resizeAnnotation(text, "nw", -100, 0, false) as TextAnnotation;
		expect(result.size).toBe(40);
		expect(result.x + result.w).toBe(110);
		expect(result.y + result.h).toBe(50);
	});

	it("调整画笔路径时按比例映射所有点", () => {
		const path: PathAnnotation = { id: "p", kind: "pen", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: "#000000", width: 2 };
		expect((resizeAnnotation(path, "se", 10, 10, false) as PathAnnotation).points).toEqual([
			{ x: 0, y: 0 },
			{ x: 20, y: 20 },
		]);
	});

	it("线段端点按住 Shift 吸附 45°", () => {
		const snapped = snap45({ x: 0, y: 0 }, { x: 100, y: 10 });
		expect(snapped.x).toBeCloseTo(Math.hypot(100, 10));
		expect(snapped.y).toBeCloseTo(0);
		const line: Annotation = { id: "l", kind: "arrow", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: "#000000", width: 4 };
		const moved = resizeAnnotation(line, "end", 90, 95, true);
		expect(moved.kind === "arrow" && Math.abs(moved.to.x - moved.to.y)).toBeLessThan(1e-9);
	});

	it("移动所有类型的标注", () => {
		const path: PathAnnotation = { id: "p", kind: "pen", points: [{ x: 1, y: 2 }], color: "#000000", width: 2 };
		expect(moveAnnotation(path, 5, 5).points).toEqual([{ x: 6, y: 7 }]);
		expect(moveAnnotation(rect("a", 0, 0, 10, 10), 3, 4)).toMatchObject({ x: 3, y: 4 });
	});

	it("视觉外框包含描边", () => {
		expect(getVisualBounds(rect("a", 10, 10, 100, 100))).toEqual({ x: 8, y: 8, w: 104, h: 104 });
	});

	it("简化路径去掉共线的点", () => {
		const points = [0, 1, 2, 3, 4].map((x) => ({ x: x * 10, y: 0 }));
		expect(simplifyPath(points, 0.5)).toEqual([
			{ x: 0, y: 0 },
			{ x: 40, y: 0 },
		]);
		expect(simplifyPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], 0.5)).toHaveLength(3);
	});

	it("丢弃太小的标注，序号递增", () => {
		expect(isDegenerate(rect("a", 0, 0, 2, 50))).toBe(true);
		expect(isDegenerate(rect("a", 0, 0, 20, 50))).toBe(false);
		const counters: Annotation[] = [
			{ id: "c1", kind: "counter", x: 0, y: 0, value: 3, color: "#000000", size: 10 },
			rect("a", 0, 0, 10, 10),
		];
		expect(nextCounterValue(counters)).toBe(4);
		expect(nextCounterValue([])).toBe(1);
	});
});
