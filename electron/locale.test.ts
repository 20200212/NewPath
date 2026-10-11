import { describe, expect, it } from "vitest";
import { isLanguageSetting, localeFromTag, resolveLocale } from "./locale";

describe("localeFromTag", () => {
	it("简体、繁体中文和其他语言", () => {
		expect(localeFromTag("zh-CN")).toBe("zh-CN");
		expect(localeFromTag("zh-Hans-SG")).toBe("zh-CN");
		expect(localeFromTag("zh")).toBe("zh-CN");
		expect(localeFromTag("zh-TW")).toBe("zh-TW");
		expect(localeFromTag("zh-HK")).toBe("zh-TW");
		expect(localeFromTag("zh_Hant_MO")).toBe("zh-TW");
		expect(localeFromTag("en-US")).toBe("en");
		expect(localeFromTag("ja-JP")).toBe("en");
		expect(localeFromTag("")).toBe("en");
	});
});

describe("resolveLocale", () => {
	it("跟随系统时看系统语言，否则用设置里的", () => {
		expect(resolveLocale("system", "zh-TW")).toBe("zh-TW");
		expect(resolveLocale("en", "zh-CN")).toBe("en");
	});

	it("校验语言设置", () => {
		expect(isLanguageSetting("system")).toBe(true);
		expect(isLanguageSetting("zh-TW")).toBe(true);
		expect(isLanguageSetting("fr")).toBe(false);
		expect(isLanguageSetting(1)).toBe(false);
	});
});
