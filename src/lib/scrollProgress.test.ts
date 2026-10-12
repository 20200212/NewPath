import { describe, expect, it } from "vitest";
import { displayedScrollStatus, isScrollLive, LOST_GRACE_MS, screensCount } from "./scrollProgress";

describe("screensCount", () => {
	it("不到 1.05 屏不显示", () => {
		expect(screensCount(800, 800)).toBeNull();
		expect(screensCount(839, 800)).toBeNull();
		expect(screensCount(0, 800)).toBeNull();
	});

	it("没有屏高时不显示", () => {
		expect(screensCount(2000, 0)).toBeNull();
		expect(screensCount(2000, Number.NaN)).toBeNull();
	});

	it("保留一位小数", () => {
		expect(screensCount(840, 800)).toBe("1.1");
		expect(screensCount(2000, 800)).toBe("2.5");
		expect(screensCount(3000, 1000)).toBe("3.0");
	});
});

describe("displayedScrollStatus", () => {
	it("其他状态原样显示", () => {
		expect(displayedScrollStatus("behind", null, 0)).toBe("behind");
		expect(displayedScrollStatus("full", 100, 10_000)).toBe("full");
	});

	it("lost 持续够久才显示", () => {
		expect(displayedScrollStatus("lost", 1000, 1000 + LOST_GRACE_MS - 1)).toBe("capturing");
		expect(displayedScrollStatus("lost", 1000, 1000 + LOST_GRACE_MS)).toBe("lost");
		expect(displayedScrollStatus("lost", null, 5000)).toBe("capturing");
	});
});

describe("isScrollLive", () => {
	it("拼接中的状态", () => {
		expect(isScrollLive("waiting")).toBe(true);
		expect(isScrollLive("lost")).toBe(true);
		expect(isScrollLive("finishing")).toBe(false);
		expect(isScrollLive("error")).toBe(false);
		expect(isScrollLive("full")).toBe(false);
	});
});
