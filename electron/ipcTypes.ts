/** 主进程与渲染进程共享的 IPC 数据结构。只放类型，不放运行时代码。 */

/** 渲染进程坐标（CSS 像素，相对于截图所在显示器左上角）。 */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** copy-path：保存到截图库后把文件路径写进剪贴板。 */
export type CaptureAction = "copy" | "copy-path" | "save" | "edit";

/** 选区窗口拿到的冻结画面。 */
export interface CaptureSessionInfo {
	/** 每次截图递增，用来丢弃过期的会话。 */
	id: number;
	/** 仅用于显示的 JPEG；最终裁剪使用主进程里的原始位图，不损失画质。 */
	imageBytes: Uint8Array;
	mimeType: string;
	scaleFactor: number;
}

export interface CaptureFinishPayload {
	rect: Rect;
	action: CaptureAction;
}

export type SaveResult = { saved: true; filePath: string } | { saved: false };

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
