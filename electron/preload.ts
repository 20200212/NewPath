import { contextBridge, ipcRenderer } from "electron";
import type {
	ActionResult,
	CaptureFinishPayload,
	CaptureSessionInfo,
	SaveResult,
	ScreenshotItem,
	SettingsState,
} from "./ipcTypes";

/** 订阅主进程推送的无参数事件，返回取消订阅的函数。 */
function subscribe(channel: string, callback: () => void) {
	const listener = () => callback();
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.removeListener(channel, listener);
	};
}

/** 渲染进程唯一能访问的主进程能力，新增 IPC 时必须在这里显式列出。 */
const api = {
	platform: process.platform,

	// 选区窗口（常驻复用：每次截图开始、结束时收到 capture:changed，再主动拉取会话）
	getCaptureSession: (): Promise<CaptureSessionInfo | null> =>
		ipcRenderer.invoke("capture:get-session"),
	onCaptureChanged: (callback: () => void) => subscribe("capture:changed", callback),
	/** 画面已经绘制完成，主进程可以让窗口可见了。 */
	captureReady: (sessionId: number): Promise<void> => ipcRenderer.invoke("capture:ready", sessionId),
	finishCapture: (payload: CaptureFinishPayload): Promise<void> =>
		ipcRenderer.invoke("capture:finish", payload),
	cancelCapture: (): Promise<void> => ipcRenderer.invoke("capture:cancel"),

	// 编辑窗口
	getPreviewImage: (): Promise<string | null> => ipcRenderer.invoke("preview:get-image"),
	copyImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke("image:copy", png),
	/** 保存到截图库。 */
	saveImage: (png: Uint8Array): Promise<SaveResult> => ipcRenderer.invoke("image:save", png),
	/** 弹出对话框另存为。 */
	saveImageAs: (png: Uint8Array): Promise<SaveResult> => ipcRenderer.invoke("image:save-as", png),

	// 主窗口：截图库（文件只用文件名指代，主进程负责定位到保存目录）
	startCapture: (): Promise<void> => ipcRenderer.invoke("capture:start"),
	listScreenshots: (): Promise<ScreenshotItem[]> => ipcRenderer.invoke("library:list"),
	onLibraryChanged: (callback: () => void) => subscribe("library:changed", callback),
	getThumbnail: (name: string): Promise<string | null> => ipcRenderer.invoke("library:thumbnail", name),
	copyScreenshot: (name: string): Promise<ActionResult> => ipcRenderer.invoke("library:copy-image", name),
	copyScreenshotPath: (name: string): Promise<ActionResult> => ipcRenderer.invoke("library:copy-path", name),
	revealScreenshot: (name: string): Promise<ActionResult> => ipcRenderer.invoke("library:reveal", name),
	editScreenshot: (name: string): Promise<ActionResult> => ipcRenderer.invoke("library:edit", name),
	renameScreenshot: (name: string, newName: string): Promise<ActionResult> =>
		ipcRenderer.invoke("library:rename", name, newName),
	deleteScreenshot: (name: string): Promise<ActionResult> => ipcRenderer.invoke("library:delete", name),

	// 主窗口：设置
	getSettings: (): Promise<SettingsState> => ipcRenderer.invoke("settings:get"),
	setCaptureShortcut: (accelerator: string): Promise<ActionResult> =>
		ipcRenderer.invoke("settings:set-shortcut", accelerator),
	/** 录制快捷键期间暂停全局快捷键。 */
	suspendShortcut: (suspended: boolean): Promise<void> => ipcRenderer.invoke("settings:suspend-shortcut", suspended),
	/** 返回新的设置；用户取消时返回 null。 */
	chooseSaveDir: (): Promise<SettingsState | null> => ipcRenderer.invoke("settings:choose-save-dir"),
	openSaveDir: (): Promise<void> => ipcRenderer.invoke("settings:open-save-dir"),

	// 自绘标题栏
	minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
	closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("electronAPI", api);
