import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "../../electron/ipcTypes";
import { mockLocaleApi } from "@/lib/mockLocale";
import { getMessages, type Messages } from "./messages";

const LOCALES: readonly string[] = ["zh-CN", "zh-TW", "en"];

/** 主进程创建窗口时带上 ?lang=，首帧就用对的语言，不会闪一下中文。 */
function initialLocale(): Locale {
	const lang = new URLSearchParams(window.location.search).get("lang") ?? "";
	return LOCALES.includes(lang) ? (lang as Locale) : "zh-CN";
}

interface I18nValue {
	locale: Locale;
	t: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocale] = useState(initialLocale);

	useEffect(() => {
		const api = window.electronAPI ?? mockLocaleApi;
		// 切换语言时主进程推送 locale:changed，再主动拉取
		return api.onLocaleChanged(() => void api.getLocale().then(setLocale));
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const value = useMemo(() => ({ locale, t: getMessages(locale) }), [locale]);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	const value = useContext(I18nContext);
	if (!value) throw new Error("useI18n 必须在 I18nProvider 里使用");
	return value;
}
