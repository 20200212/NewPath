/** 主进程与渲染进程共享的 IPC 数据结构。只放类型，不放运行时代码。 */

/** 渲染进程坐标（CSS 像素，相对于截图所在显示器左上角）。 */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * copy-path：保存到截图库后把文件路径写进剪贴板；pin：钉在桌面上；
 * stitch：只在拼接模式下使用，把选区追加到编辑窗口。
 */
export type CaptureAction = "copy" | "copy-path" | "save" | "edit" | "pin" | "stitch";

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
}

/** 截图时屏幕上可见的窗口，坐标与 Rect 相同（选区窗口里的 CSS 像素）。 */
export interface DetectedWindow {
	rect: Rect;
	title: string;
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

export interface AppSettings {
	/** Electron 加速键格式，例如 Alt+C。 */
	captureShortcut: string;
	/** 截图库目录，截图的"保存"直接写到这里。 */
	saveDir: string;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export interface SettingsState extends AppSettings {
	/** 全局快捷键是否注册成功（可能被其他程序占用）。 */
	shortcutRegistered: boolean;
}
