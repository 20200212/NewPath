import type { Locale } from "../../../electron/ipcTypes";

/** 多个窗口共用的文案。 */
const zhCN = {
	minimize: "最小化",
	maximizeRestore: "最大化 / 还原",
	close: "关闭",
	done: "完成",
	/** 提示里带上快捷键，中文用全角括号。 */
	withShortcut: (label: string, shortcut: string) => `${label}（${shortcut}）`,
};

export const common: Record<Locale, typeof zhCN> = {
	"zh-CN": zhCN,
	"zh-TW": {
		minimize: "最小化",
		maximizeRestore: "最大化 / 還原",
		close: "關閉",
		done: "完成",
		withShortcut: (label: string, shortcut: string) => `${label}（${shortcut}）`,
	},
	en: {
		minimize: "Minimize",
		maximizeRestore: "Maximize / restore",
		close: "Close",
		done: "Done",
		withShortcut: (label: string, shortcut: string) => `${label} (${shortcut})`,
	},
};
