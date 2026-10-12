import { describe, expect, it } from "vitest";
import { composePreview } from "./scrollPreview";

function rows(width: number, count: number, value: (x: number, y: number) => number) {
	const pixels = new Uint8Array(width * count * 4);
	for (let y = 0; y < count; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const v = value(x, y);
			pixels.set([v, v, v, 255], (y * width + x) * 4);
		}
	}
	return { pixels, rows: count };
}

describe("composePreview", () => {
	it("没有内容时返回 null", () => {
		expect(composePreview([], 100)).toBeNull();
		expect(composePreview([{ pixels: new Uint8Array(0), rows: 0 }], 100)).toBeNull();
	});

	it("不放大：比面板窄的长图原样输出", () => {
		const preview = composePreview([rows(4, 3, (x) => x * 10)], 4, 432, 640);
		expect(preview).toMatchObject({ width: 4, height: 3 });
		expect(Array.from(preview!.pixels.subarray(0, 16))).toEqual([
			0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255,
		]);
	});

	it("按整数倍缩小时取平均值", () => {
		// 4×4 的棋盘格缩到 2×2，每个输出像素都是 0 和 200 的平均
		const preview = composePreview([rows(4, 4, (x, y) => ((x + y) % 2 ? 200 : 0))], 4, 2, 640);
		expect(preview).toMatchObject({ width: 2, height: 2 });
		for (let i = 0; i < 4; i += 1) expect(preview!.pixels[i * 4]).toBe(100);
	});

	it("太长时只保留最下面的部分，并跨段读取", () => {
		const top = rows(2, 3, () => 10);
		const bottom = rows(2, 3, () => 250);
		const preview = composePreview([top, bottom], 2, 2, 4);
		expect(preview).toMatchObject({ width: 2, height: 4 });
		// 保留最后 4 行：1 行来自 top（10）、3 行来自 bottom（250）
		expect(preview!.pixels[0]).toBe(10);
		expect(preview!.pixels[1 * 2 * 4]).toBe(250);
		expect(preview!.pixels[3 * 2 * 4]).toBe(250);
	});

	it("非整数比例也能覆盖到最后一行一列", () => {
		const preview = composePreview([rows(3, 3, (x, y) => (x === 2 && y === 2 ? 255 : 0))], 3, 2, 2);
		expect(preview).toMatchObject({ width: 2, height: 2 });
		// 右下角输出像素包含了源图右下角那个亮点
		expect(preview!.pixels[(1 * 2 + 1) * 4]).toBeGreaterThan(0);
	});
});
