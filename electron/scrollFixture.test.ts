import { describe, expect, it } from "vitest";
import { fixtureBars, fixtureKeys, fixturePosition, renderFixtureFrame } from "./scrollFixture";

describe("滚动夹具", () => {
	it("时间线单调递增，先停 0.6 秒再出发，最后停在底部", () => {
		const keys = fixtureKeys(4000, 800);
		for (let i = 1; i < keys.length; i += 1) expect(keys[i].time).toBeGreaterThanOrEqual(keys[i - 1].time);
		expect(fixturePosition(0, keys, 4000, 800)).toBe(0);
		expect(fixturePosition(0.5, keys, 4000, 800)).toBe(0);
		expect(fixturePosition(0.7, keys, 4000, 800)).toBeGreaterThan(0);
		expect(fixturePosition(1000, keys, 4000, 800)).toBe(3200);
		expect(keys[keys.length - 1].position).toBe(3200);
	});

	it("中途往回滚一段", () => {
		const keys = fixtureKeys(4000, 800);
		const middle = 3200 * 0.4;
		const positions = keys.map((key) => key.position);
		expect(positions).toContain(middle);
		expect(positions).toContain(Math.max(0, middle - 800 * 0.3));
	});

	it("页面不比一屏高时位置始终为 0", () => {
		const keys = fixtureKeys(500, 800);
		expect(fixturePosition(0, keys, 500, 800)).toBe(0);
		expect(fixturePosition(5, keys, 500, 800)).toBe(0);
	});

	it("渲染的帧由顶部栏、中间内容、底部栏组成", () => {
		const width = 2;
		const pageHeight = 64;
		const frameHeight = 16;
		const page = new Uint8Array(width * pageHeight * 4);
		for (let y = 0; y < pageHeight; y += 1) page.fill(y, y * width * 4, (y + 1) * width * 4);
		const { header, footer } = fixtureBars(frameHeight);
		expect({ header, footer }).toEqual({ header: 2, footer: 1 });
		const out = new Uint8Array(width * frameHeight * 4);
		renderFixtureFrame(page, width, pageHeight, frameHeight, 10, out);
		const row = (index: number) => out[index * width * 4];
		expect(row(0)).toBe(0);
		expect(row(1)).toBe(1);
		expect(row(2)).toBe(12);
		expect(row(frameHeight - footer - 1)).toBe(12 + (frameHeight - header - footer) - 1);
		expect(row(frameHeight - 1)).toBe(pageHeight - 1);
	});
});
