import path from "node:path";

/**
 * 只在开发模式（未打包）下生效的环境变量，打包后全部忽略：
 * - NEWPATH_USER_DATA_DIR：用户数据目录。默认是 appData 下的“NewPath Dev”，不和安装版共用设置和单实例锁；
 * - NEWPATH_DEV_CAPTURE_FILE：一张 PNG，截图时代替真实屏幕，不需要屏幕录制权限；
 * - NEWPATH_DEV_SCROLL_FIXTURE：一张很高的 PNG，滚动截图时代替屏幕“滚动”；
 * - NEWPATH_DEV_SHORTCUT=0：不注册全局截图快捷键，免得和正在运行的安装版抢；
 * - NEWPATH_DEV_REMOTE_DEBUGGING_PORT：打开 Chromium 远程调试端口；
 * - NEWPATH_DEV_SETTINGS_BUNDLE：测试拖拽授权小窗时，用另一个应用（Bundle ID）代替“系统设置”。
 */
export interface DevOptions {
	userDataDir: string | null;
	captureFile: string | null;
	scrollFixture: string | null;
	shortcutEnabled: boolean;
	remoteDebuggingPort: string | null;
	settingsBundle: string | null;
}

type Env = Record<string, string | undefined>;

const OFF_VALUES = ["0", "false", "off", "no"];

/** 开发模式下默认的用户数据目录名。 */
export const DEV_USER_DATA_NAME = "NewPath Dev";

function value(env: Env, key: string): string | null {
	const item = env[key]?.trim();
	return item ? item : null;
}

export function readDevOptions(env: Env, isPackaged: boolean, appDataDir: string): DevOptions {
	if (isPackaged) {
		return {
			userDataDir: null,
			captureFile: null,
			scrollFixture: null,
			shortcutEnabled: true,
			remoteDebuggingPort: null,
			settingsBundle: null,
		};
	}
	const userDataDir = value(env, "NEWPATH_USER_DATA_DIR");
	const captureFile = value(env, "NEWPATH_DEV_CAPTURE_FILE");
	const scrollFixture = value(env, "NEWPATH_DEV_SCROLL_FIXTURE");
	const port = value(env, "NEWPATH_DEV_REMOTE_DEBUGGING_PORT");
	const shortcut = value(env, "NEWPATH_DEV_SHORTCUT");
	return {
		userDataDir: userDataDir ? path.resolve(userDataDir) : path.join(appDataDir, DEV_USER_DATA_NAME),
		captureFile: captureFile ? path.resolve(captureFile) : null,
		scrollFixture: scrollFixture ? path.resolve(scrollFixture) : null,
		shortcutEnabled: !shortcut || !OFF_VALUES.includes(shortcut.toLowerCase()),
		remoteDebuggingPort: port && /^\d{2,5}$/.test(port) ? port : null,
		settingsBundle: value(env, "NEWPATH_DEV_SETTINGS_BUNDLE"),
	};
}

/** 常见终端和编辑器的 Bundle ID → 显示名。 */
const HOST_NAMES: Record<string, string> = {
	"com.apple.Terminal": "Terminal",
	"com.googlecode.iterm2": "iTerm",
	"com.microsoft.VSCode": "Visual Studio Code",
	"com.microsoft.VSCodeInsiders": "Visual Studio Code - Insiders",
	"com.todesktop.230313mzl4w4u92": "Cursor",
	"com.exafunction.windsurf": "Windsurf",
	"dev.warp.Warp-Stable": "Warp",
	"com.mitchellh.ghostty": "Ghostty",
	"com.github.wez.wezterm": "WezTerm",
	"net.kovidgoyal.kitty": "kitty",
	"org.alacritty": "Alacritty",
	"co.zeit.hyper": "Hyper",
	"dev.zed.Zed": "Zed",
	"com.jetbrains.WebStorm": "WebStorm",
	"com.jetbrains.intellij": "IntelliJ IDEA",
};

/** TERM_PROGRAM 的取值 → 显示名，拿不到 Bundle ID 时用。 */
const TERM_PROGRAM_NAMES: Record<string, string> = {
	Apple_Terminal: "Terminal",
	"iTerm.app": "iTerm",
	vscode: "Visual Studio Code",
	WarpTerminal: "Warp",
	ghostty: "Ghostty",
	WezTerm: "WezTerm",
	Hyper: "Hyper",
};

/**
 * 开发模式下屏幕录制权限记在哪个应用上。从终端启动时，Electron 是终端的子进程，
 * macOS 按“负责进程”记权限，记在终端（或编辑器里的终端）上，不是 Electron.app。
 * 返回 Bundle ID 和显示名；不是从终端启动时返回 null。
 */
export function devPermissionHost(env: Env): { bundleId: string | null; name: string } | null {
	const bundleId = value(env, "__CFBundleIdentifier");
	if (bundleId && bundleId !== "com.github.Electron") {
		return { bundleId, name: HOST_NAMES[bundleId] ?? bundleId };
	}
	const program = value(env, "TERM_PROGRAM");
	if (program) return { bundleId: null, name: TERM_PROGRAM_NAMES[program] ?? program };
	return null;
}
