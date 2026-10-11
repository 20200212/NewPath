import { describe, expect, it } from "vitest";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";

describe("screenshotFiles", () => {
	it("生成不含非法字符的默认文件名", () => {
		const name = defaultScreenshotName(new Date(2026, 9, 11, 9, 5, 7));
		expect(name).toBe("截图 2026-10-11 090507.png");
		expect(name).not.toMatch(/[<>:"/\|?*]/);
	});

	it("补全 .png 扩展名", () => {
		expect(ensurePngExtension("C:\shots\a")).toBe("C:\shots\a.png");
		expect(ensurePngExtension("C:\shots\a.PNG")).toBe("C:\shots\a.PNG");
	});
});
