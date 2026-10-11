import type { LanguageSetting, Locale } from "./ipcTypes";

export const LOCALES: readonly Locale[] = ["zh-CN", "zh-TW", "en"];
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["system", ...LOCALES];

export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return typeof value === "string" && (LANGUAGE_SETTINGS as readonly string[]).includes(value);
}

/** 把系统语言标签（如 zh-Hant-HK、en-US）归到支持的语言；非中文一律用英文。 */
export function localeFromTag(tag: string): Locale {
	const parts = tag.toLowerCase().replace(/_/g, "-").split("-");
	if (parts[0] !== "zh") return "en";
	if (parts.includes("hant") || parts.some((part) => part === "tw" || part === "hk" || part === "mo")) return "zh-TW";
	return "zh-CN";
}

export function resolveLocale(setting: LanguageSetting, systemTag: string): Locale {
	return setting === "system" ? localeFromTag(systemTag) : setting;
}
