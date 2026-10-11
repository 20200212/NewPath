import type { Locale } from "../../electron/ipcTypes";
import type { ElectronAPI } from "../../electron/preload";

export type LocaleApi = Pick<ElectronAPI, "getLocale" | "onLocaleChanged">;

let locale: Locale = "zh-CN";
const listeners = new Set<() => void>();

/** dev:ui 下代替主进程的语言切换。 */
export function setMockLocale(next: Locale) {
	locale = next;
	listeners.forEach((listener) => listener());
}

export const mockLocaleApi: LocaleApi = {
	getLocale: async () => locale,
	onLocaleChanged: (callback) => {
		listeners.add(callback);
		return () => listeners.delete(callback);
	},
};
