import { formatAppShortcut } from "./accelerator";

/** 是否运行在 macOS 上。dev:ui 下没有 electronAPI，按非 Mac 处理；node 环境（测试）下没有 window。 */
export const isMac = typeof window !== "undefined" && window.electronAPI?.platform === "darwin";

/** 应用内快捷键的修饰键名：处理按键时 Ctrl 和 ⌘ 都认，提示里按平台显示。 */
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** 应用内快捷键的提示文本，见 formatAppShortcut。 */
export function appShortcut(shortcut: string): string {
	return formatAppShortcut(shortcut, isMac);
}
