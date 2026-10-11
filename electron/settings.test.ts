import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./settings";

const defaults = { captureShortcut: "Alt+C", saveDir: "D:\\shots" };

describe("normalizeSettings", () => {
	it("保留合法字段", () => {
		expect(normalizeSettings({ captureShortcut: "Ctrl+Shift+A", saveDir: "E:\\pics" }, defaults)).toEqual({
			captureShortcut: "Ctrl+Shift+A",
			saveDir: "E:\\pics",
		});
	});

	it("缺失、为空或类型错误时回退到默认值", () => {
		expect(normalizeSettings({ captureShortcut: 1, saveDir: "  " }, defaults)).toEqual(defaults);
		expect(normalizeSettings(null, defaults)).toEqual(defaults);
		expect(normalizeSettings("oops", defaults)).toEqual(defaults);
	});
});
