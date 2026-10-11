import { describe, expect, it } from "vitest";
import { layoutLine, parseOcrOutput, pickOcrScale, planOcrTiles } from "./ocrResult";

const word = (text: string, x = 0) => ({ text, x, y: 0, width: 10, height: 10 });

describe("ocrResult", () => {
	it("中文之间不加空格，英文单词之间加空格", () => {
		expect(layoutLine([word("截"), word("图"), word("Hello"), word("World")]).text).toBe("截图Hello World");
		const { segments } = layoutLine([word("ab"), word("cd")]);
		expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
			[0, 2],
			[3, 5],
		]);
	});

	it("小图放大一倍，宽图不超过引擎上限", () => {
		expect(pickOcrScale({ width: 1000, height: 800 })).toBe(2);
		expect(pickOcrScale({ width: 3000, height: 2000 })).toBe(1);
		expect(pickOcrScale({ width: 20000, height: 100 })).toBe(0.5);
	});

	it("长图纵向切块", () => {
		expect(planOcrTiles(9000)).toEqual([
			{ offsetY: 0, height: 4000 },
			{ offsetY: 4000, height: 4000 },
			{ offsetY: 8000, height: 1000 },
		]);
	});

	it("解析输出并换算回原图坐标", () => {
		const json = JSON.stringify({
			pages: [
				{ lines: [{ words: [{ text: "你", x: 10, y: 20, w: 30, h: 40 }] }] },
				// ConvertTo-Json 可能把单元素数组写成对象
				{ lines: { words: { text: "ok", x: 0, y: 0, w: 8, h: 8 } } },
			],
		});
		const tiles = [
			{ offsetY: 0, height: 4000 },
			{ offsetY: 4000, height: 100 },
		];
		expect(parseOcrOutput(json, tiles, 2)).toEqual({
			ok: true,
			lines: [
				{ text: "你", words: [{ text: "你", x: 5, y: 10, width: 15, height: 20 }] },
				{ text: "ok", words: [{ text: "ok", x: 0, y: 2000, width: 4, height: 4 }] },
			],
		});
	});

	it("识别脚本报错或输出非法", () => {
		expect(parseOcrOutput('{"error":"no-engine"}', [], 1)).toEqual({ ok: false, error: "no-engine" });
		expect(parseOcrOutput("oops", [], 1)).toEqual({ ok: false, error: "invalid-output" });
	});
});
