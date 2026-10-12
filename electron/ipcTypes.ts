/** 主进程与渲染进程共享的 IPC 数据结构。只放类型，不放运行时代码。 */

/** 渲染进程坐标（CSS 像素，相对于截图所在显示器左上角）。 */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 渲染进程坐标中的一个点，坐标系与 Rect 相同。 */
export interface Point {
	x: number;
	y: number;
}

/**
 * copy-path：保存到截图库后把文件路径写进剪贴板；pin：钉在桌面上；
 * stitch：只在拼接模式下使用，把选区追加到编辑窗口；
 * scroll：从选区开始滚动截图（macOS 14 起），拼好的长图打开编辑器，拼接模式下追加到编辑窗口。
 */
export type CaptureAction = "copy" | "copy-path" | "save" | "edit" | "pin" | "stitch" | "scroll";

/** capture：普通截图；stitch：编辑窗口发起的"再截一张"。 */
export type CaptureMode = "capture" | "stitch";

/** 选区窗口拿到的冻结画面。 */
export interface CaptureSessionInfo {
	/** 每次截图递增，用来丢弃过期的会话。 */
	id: number;
	/** 仅用于显示的 JPEG；最终裁剪使用主进程里的原始位图，不损失画质。 */
	imageBytes: Uint8Array;
	mimeType: string;
	scaleFactor: number;
	mode: CaptureMode;
	/** 截图开始时光标的位置；鼠标不动也能立刻高亮光标下的窗口。 */
	cursor: Point;
	/** 这台机器能不能滚动截图（macOS 14 起）。 */
	scrollAvailable: boolean;
	/** 从托盘或命令行的“滚动截图”进来：一开始就处在滚动截图模式。 */
	scrollMode: boolean;
}

/** 截图时屏幕上可见的窗口，坐标与 Rect 相同（选区窗口里的 CSS 像素）。 */
export interface DetectedWindow {
	rect: Rect;
	title: string;
	/** 窗口编号（macOS 的 CGWindowID、Windows 的 HWND），单击选中窗口后可以单独截取这个窗口；Linux 没有。 */
	id?: number;
}

/** 窗口列表比画面晚到，用 sessionId 对应到截图会话。 */
export interface CaptureWindowsInfo {
	sessionId: number;
	/** 按 Z 序从前往后排列。 */
	windows: DetectedWindow[];
}

export interface CaptureFinishPayload {
	rect: Rect;
	action: CaptureAction;
	/** 选区是单击选中的窗口且没有再调整过：改为单独截取这个窗口（被遮住的部分也完整，macOS 上带透明圆角）。 */
	windowId?: number;
}

export type SaveResult = { saved: true; filePath: string } | { saved: false };

/** 钉图窗口要显示的图片。 */
export interface PinImageInfo {
	dataUrl: string;
}

/** OCR 识别出的一个词，坐标是图片像素。 */
export interface OcrWord {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OcrLine {
	text: string;
	words: OcrWord[];
}

export type OcrResult = { ok: true; lines: OcrLine[] } | { ok: false; reason: string };

export type SensitiveKind =
	| "username"
	| "hostname"
	| "email"
	| "ip"
	| "mac"
	| "secret"
	| "phone"
	| "id-card";

/** 智能打码找到的敏感区域，坐标是图片像素。 */
export interface SensitiveRegion extends Rect {
	kind: SensitiveKind;
}

export type SensitiveResult = { ok: true; regions: SensitiveRegion[] } | { ok: false; reason: string };

/** 截图库里的一项。只传文件名，主进程负责拼出完整路径并校验。 */
export interface ScreenshotItem {
	name: string;
	size: number;
	mtimeMs: number;
}

/** 界面语言。 */
export type Locale = "zh-CN" | "zh-TW" | "en";

/** 设置里选的语言；system 表示跟随系统。 */
export type LanguageSetting = "system" | Locale;

/** overlay：NewPath 自己的选区界面；system：macOS 系统自带的框选（screencapture -i），选完直接打开编辑器。 */
export type SelectionMode = "overlay" | "system";

export interface AppSettings {
	/** Electron 加速键格式，例如 Alt+C。 */
	captureShortcut: string;
	/** 截图库目录，截图的"保存"直接写到这里。 */
	saveDir: string;
	language: LanguageSetting;
	/** 选区方式，只在 macOS 上可选，其他平台总是 overlay。 */
	selectionMode: SelectionMode;
	/** 看过的欢迎引导版本，小于当前版本时启动后打开引导。 */
	onboardingVersion: number;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export interface SettingsState extends AppSettings {
	/** 全局快捷键是否注册成功（可能被其他程序占用）。 */
	shortcutRegistered: boolean;
	/** 按设置和系统语言解析出的实际界面语言。 */
	locale: Locale;
	/** 开机自启以系统里的登录项为准，不写进设置文件。 */
	openAtLogin: boolean;
	/** 开发模式和 Linux 下不支持开机自启。 */
	openAtLoginSupported: boolean;
	/** 屏幕录制权限；只有 macOS 需要，其他平台总是 granted。 */
	screenPermission: ScreenPermission;
}

/** systemPreferences.getMediaAccessStatus("screen") 的结果。 */
export type ScreenPermission = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** 欢迎引导的步骤：welcome 介绍快捷键和开机自启，permission 申请屏幕录制权限（只在 macOS 上），done 完成。 */
export type OnboardingStep = "welcome" | "permission" | "done";

/** 开发模式下屏幕录制权限的归属说明，打包后为 null。 */
export interface DevPermissionInfo {
	/** 从终端启动时权限记在终端（或编辑器）上，这里是它的名字；不是从终端启动时为 null。 */
	host: string | null;
	/** 用夹具图片代替了屏幕（NEWPATH_DEV_CAPTURE_FILE），截图不需要权限。 */
	fixture: boolean;
}

export interface OnboardingState {
	step: OnboardingStep;
	permission: ScreenPermission;
	/** Electron 加速键格式，显示时用 formatAccelerator。 */
	captureShortcut: string;
	shortcutRegistered: boolean;
	openAtLogin: boolean;
	openAtLoginSupported: boolean;
	dev: DevPermissionInfo | null;
}

/**
 * 滚动截图的状态。waiting：等待开始滚动；capturing：正在拼接；behind：滚动太快，跟不上；
 * lost：找不到和上一屏重叠的部分；full：达到长度上限；finishing：正在生成长图；error：失败，稍后自动结束。
 */
export type ScrollStatus = "waiting" | "capturing" | "behind" | "lost" | "full" | "finishing" | "error";

export interface ScrollCaptureState {
	status: ScrollStatus;
	/** 现在结束的话长图的尺寸（像素）。 */
	width: number;
	height: number;
	/** 一屏的高度（像素），用来显示“已滚动 N 屏”。 */
	frameHeight: number;
	/** 预览图每更新一次就变一次；变了再调用 getScrollPreview 拉取。 */
	previewId: number;
}
