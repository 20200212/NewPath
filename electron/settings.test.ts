import { describe, expect, it } from "vitest";
import type { AppSettings } from "./ipcTypes";
import { normalizeSettings } from "./settings";

const defaults: AppSettings = {
	captureShortcut: "Alt+C",
	saveDir: "D:\\shots",
	language: "system",
	selectionMode: "overlay",
	onboardingVersion: 0,
};

describe("normalizeSettings", () => {
	it("保留合法字段", () => {
		expect(
			normalizeSettings(
				{ captureShortcut: "Ctrl+Shift+A", saveDir: "E:\\pics", language: "en", selectionMode: "system", onboardingVersion: 1 },
				defaults,
			),
		).toEqual({
			captureShortcut: "Ctrl+Shift+A",
			saveDir: "E:\\pics",
			language: "en",
			selectionMode: "system",
			onboardingVersion: 1,
		});
	});

	it("缺失、为空或类型错误时回退到默认值", () => {
		expect(
			normalizeSettings(
				{ captureShortcut: 1, saveDir: "  ", language: "fr", selectionMode: "native", onboardingVersion: -1 },
				defaults,
			),
		).toEqual(defaults);
		expect(normalizeSettings({ onboardingVersion: 1.5 }, defaults)).toEqual(defaults);
		expect(normalizeSettings(null, defaults)).toEqual(defaults);
		expect(normalizeSettings("oops", defaults)).toEqual(defaults);
	});
});
