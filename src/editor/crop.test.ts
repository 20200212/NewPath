import { describe, expect, it } from "vitest";
import { combineCrops, cropAnnotations, cropHitAt, normalizeCrop } from "./crop";
import type { Annotation } from "./types";

describe("crop", () => {
	it("多次裁剪的偏移累加", () => {
		expect(combineCrops(null, { x: 10, y: 10, width: 50, height: 50 })).toEqual({ x: 10, y: 10, width: 50, height: 50 });
		expect(combineCrops({ x: 10, y: 20, width: 100, height: 100 }, { x: 5, y: 5, width: 20, height: 30 })).toEqual({
			x: 15,
			y: 25,
			width: 20,
			height: 30,
		});
	});

	it("平移标注，删掉完全在框外的", () => {
		const annotations: Annotation[] = [
			{ id: "in", kind: "counter", x: 60, y: 60, value: 1, color: "#000000", size: 10 },
			{ id: "out", kind: "counter", x: 500, y: 500, value: 2, color: "#000000", size: 10 },
		];
		expect(cropAnnotations(annotations, { x: 50, y: 50, width: 100, height: 100 })).toEqual([
			{ id: "in", kind: "counter", x: 10, y: 10, value: 1, color: "#000000", size: 10 },
		]);
	});

	it("取整、限制在图片内，等于整图时不裁剪", () => {
		const image = { width: 200, height: 100 };
		expect(normalizeCrop({ x: -5.4, y: 10.6, width: 100, height: 200 }, image)).toEqual({ x: 0, y: 11, width: 95, height: 89 });
		expect(normalizeCrop({ x: 0, y: 0, width: 200, height: 100 }, image)).toBeNull();
		expect(normalizeCrop({ x: 10, y: 10, width: 0.2, height: 50 }, image)).toBeNull();
	});

	it("判断光标在裁剪框的边、角、内部还是外部", () => {
		const rect = { x: 100, y: 100, width: 200, height: 100 };
		expect(cropHitAt(rect, { x: 101, y: 99 }, 8)).toBe("nw");
		expect(cropHitAt(rect, { x: 200, y: 203 }, 8)).toBe("s");
		expect(cropHitAt(rect, { x: 297, y: 150 }, 8)).toBe("e");
		expect(cropHitAt(rect, { x: 200, y: 150 }, 8)).toBe("move");
		expect(cropHitAt(rect, { x: 50, y: 150 }, 8)).toBeNull();
	});
});
