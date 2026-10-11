import type { ActionResult, ScreenshotItem, SettingsState } from "../../electron/ipcTypes";
import type { ElectronAPI } from "../../electron/preload";
import { createMockScreenshot } from "./mockImage";
import { setMockLocale } from "./mockLocale";

/** 主窗口用到的那部分接口。 */
export type MainApi = Pick<
	ElectronAPI,
	| "startCapture"
	| "listScreenshots"
	| "onLibraryChanged"
	| "getThumbnail"
	| "copyScreenshot"
	| "copyScreenshotPath"
	| "revealScreenshot"
	| "editScreenshot"
	| "renameScreenshot"
	| "deleteScreenshot"
	| "getSettings"
	| "setCaptureShortcut"
	| "suspendShortcut"
	| "chooseSaveDir"
	| "openSaveDir"
	| "setLanguage"
	| "setOpenAtLogin"
	| "minimizeWindow"
	| "closeWindow"
>;

const now = Date.now();
const HOUR = 3_600_000;

let items: ScreenshotItem[] = [
	{ name: "截图 2026-10-11 153045.png", size: 2_516_582, mtimeMs: now - 0.2 * HOUR },
	{ name: "设计稿评审.png", size: 864_102, mtimeMs: now - 3 * HOUR },
	{ name: "截图 2026-10-10 091512.png", size: 126_976, mtimeMs: now - 30 * HOUR },
	{ name: "报错弹窗.png", size: 48_211, mtimeMs: now - 52 * HOUR },
	{ name: "截图 2026-10-05 112033.png", size: 8_493_465, mtimeMs: now - 150 * HOUR },
];

let settings: SettingsState = {
	captureShortcut: "Alt+C",
	saveDir: "C:\\Users\\Admin\\Pictures\\NewPath",
	shortcutRegistered: true,
	language: "system",
	locale: "zh-CN",
	openAtLogin: false,
	openAtLoginSupported: true,
};

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const ok: ActionResult = { ok: true };
const log = (...args: unknown[]) => console.info("[dev:ui]", ...args);

/** 纯浏览器调试（npm run dev:ui）时代替 window.electronAPI，数据只存在内存里。 */
export const mockMainApi: MainApi = {
	startCapture: async () => log("startCapture"),
	listScreenshots: async () => [...items],
	onLibraryChanged: (callback) => {
		listeners.add(callback);
		return () => listeners.delete(callback);
	},
	getThumbnail: async () => createMockScreenshot(240, 160),
	copyScreenshot: async () => ok,
	copyScreenshotPath: async () => ok,
	revealScreenshot: async (name) => (log("reveal", name), ok),
	editScreenshot: async (name) => (log("edit", name), ok),
	renameScreenshot: async (name, newName) => {
		const next = newName.trim();
		if (!next) return { ok: false, reason: "文件名不能为空" };
		const finalName = next.toLowerCase().endsWith(".png") ? next : `${next}.png`;
		items = items.map((item) => (item.name === name ? { ...item, name: finalName } : item));
		changed();
		return ok;
	},
	deleteScreenshot: async (name) => {
		items = items.filter((item) => item.name !== name);
		changed();
		return ok;
	},
	getSettings: async () => ({ ...settings }),
	setCaptureShortcut: async (accelerator) => {
		settings = { ...settings, captureShortcut: accelerator };
		return ok;
	},
	suspendShortcut: async (suspended) => log("suspendShortcut", suspended),
	chooseSaveDir: async () => {
		settings = { ...settings, saveDir: "D:\\Screenshots" };
		return { ...settings };
	},
	openSaveDir: async () => log("openSaveDir"),
	setLanguage: async (language) => {
		const locale = language === "system" ? "zh-CN" : language;
		settings = { ...settings, language, locale };
		setMockLocale(locale);
		return { ...settings };
	},
	setOpenAtLogin: async (enabled) => {
		settings = { ...settings, openAtLogin: enabled };
		return ok;
	},
	minimizeWindow: async () => log("minimizeWindow"),
	closeWindow: async () => log("closeWindow"),
};
