import { afterEach, describe, expect, it } from "vitest";
import { setMainLocale } from "./i18n";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";

describe("screenshotFiles", () => {
	afterEach(() => setMainLocale("zh-CN"));

	it("生成不含非法字符的默认文件名", () => {
		const name = defaultScreenshotName(new Date(2026, 9, 11, 9, 5, 7));
		expect(name).toBe("截图 2026-10-11 090507.png");
		expect(name).not.toMatch(/[<>:"/\|?*]/);
	});

	it("文件名前缀随界面语言变化", () => {
		const date = new Date(2026, 9, 11, 9, 5, 7);
		setMainLocale("zh-TW");
		expect(defaultScreenshotName(date)).toBe("截圖 2026-10-11 090507.png");
		setMainLocale("en");
		expect(defaultScreenshotName(date)).toBe("Screenshot 2026-10-11 090507.png");
	});

	it("补全 .png 扩展名", () => {
		expect(ensurePngExtension("C:\shots\a")).toBe("C:\shots\a.png");
		expect(ensurePngExtension("C:\shots\a.PNG")).toBe("C:\shots\a.PNG");
	});
});
