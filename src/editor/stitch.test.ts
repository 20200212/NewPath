import { describe, expect, it } from "vitest";
import { movePiece, remapAnnotations, stitchLayout } from "./stitch";
import type { Annotation } from "./types";

const pieces = [
	{ id: "a", width: 400, height: 100 },
	{ id: "b", width: 200, height: 50 },
];

const counter = (id: string, x: number, y: number): Annotation => ({ id, kind: "counter", x, y, value: 1, color: "#000000", size: 5 });

describe("stitch", () => {
	it("纵向排列、水平居中、留出间距", () => {
		expect(stitchLayout(pieces, 10)).toEqual({
			width: 400,
			height: 160,
			placements: [
				{ id: "a", x: 0, y: 0, width: 400, height: 100 },
				{ id: "b", x: 100, y: 110, width: 200, height: 50 },
			],
		});
		expect(stitchLayout([], 10)).toEqual({ width: 0, height: 0, placements: [] });
	});

	it("调整顺序后标注跟着所在的图移动", () => {
		const from = stitchLayout(pieces, 10);
		const to = stitchLayout(movePiece(pieces, 1, -1), 10);
		const result = remapAnnotations([counter("on-a", 50, 50), counter("on-b", 150, 120)], from, to);
		// 新顺序：b 在上（x 100，y 0），a 在下（y 60）
		expect(result).toEqual([counter("on-a", 50, 110), counter("on-b", 150, 10)]);
	});

	it("删掉一张图时，上面的标注一起删掉", () => {
		const from = stitchLayout(pieces, 0);
		const to = stitchLayout([pieces[0]], 0);
		expect(remapAnnotations([counter("on-a", 10, 10), counter("on-b", 150, 120)], from, to)).toEqual([counter("on-a", 10, 10)]);
	});

	it("越界的移动保持原样", () => {
		expect(movePiece(pieces, 0, -1)).toEqual(pieces);
		expect(movePiece(pieces, 0, 1).map((piece) => piece.id)).toEqual(["b", "a"]);
	});
});
