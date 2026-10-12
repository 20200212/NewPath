import { contextBridge, ipcRenderer } from "electron";
import type {
	ActionResult,
	CaptureFinishPayload,
	CaptureSessionInfo,
	CaptureWindowsInfo,
	LanguageSetting,
	Locale,
	OcrResult,
	OnboardingState,
	PinImageInfo,
	SaveResult,
	ScreenPermission,
	ScreenshotItem,
	ScrollCaptureState,
	SelectionMode,
	SensitiveResult,
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

	// 所有窗口：界面语言（切换时收到 locale:changed，再主动拉取）
	getLocale: (): Promise<Locale> => ipcRenderer.invoke("locale:get"),
	onLocaleChanged: (callback: () => void) => subscribe("locale:changed", callback),

	// 选区窗口（常驻复用：每次截图开始、结束时收到 capture:changed，再主动拉取会话）
	getCaptureSession: (): Promise<CaptureSessionInfo | null> =>
		ipcRenderer.invoke("capture:get-session"),
	onCaptureChanged: (callback: () => void) => subscribe("capture:changed", callback),
	/** 画面已经绘制完成，主进程可以让窗口可见了。 */
	captureReady: (sessionId: number): Promise<void> => ipcRenderer.invoke("capture:ready", sessionId),
	finishCapture: (payload: CaptureFinishPayload): Promise<void> =>
		ipcRenderer.invoke("capture:finish", payload),
	cancelCapture: (): Promise<void> => ipcRenderer.invoke("capture:cancel"),
	/** 窗口列表比画面晚到：收到 capture:windows 后再拉取；还没枚举完时返回 null。 */
	getCaptureWindows: (): Promise<CaptureWindowsInfo | null> => ipcRenderer.invoke("capture:get-windows"),
	onCaptureWindowsChanged: (callback: () => void) => subscribe("capture:windows", callback),

	// 编辑窗口
	getPreviewImage: (): Promise<string | null> => ipcRenderer.invoke("preview:get-image"),
	copyImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke("image:copy", png),
	/** 保存到截图库。 */
	saveImage: (png: Uint8Array): Promise<SaveResult> => ipcRenderer.invoke("image:save", png),
	/** 弹出对话框另存为。 */
	saveImageAs: (png: Uint8Array): Promise<SaveResult> => ipcRenderer.invoke("image:save-as", png),
	pinImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke("image:pin", png),
	copyText: (text: string): Promise<void> => ipcRenderer.invoke("text:copy", text),
	/** 拼接：隐藏编辑窗口再截一张，截完收到 preview:stitch-added，再调用 takeStitchImage 取图。 */
	startStitch: (): Promise<void> => ipcRenderer.invoke("preview:start-stitch"),
	onStitchAdded: (callback: () => void) => subscribe("preview:stitch-added", callback),
	takeStitchImage: (): Promise<string | null> => ipcRenderer.invoke("preview:take-stitch"),
	recognizeText: (png: Uint8Array): Promise<OcrResult> => ipcRenderer.invoke("ocr:recognize", png),
	findSensitiveRegions: (png: Uint8Array): Promise<SensitiveResult> => ipcRenderer.invoke("ocr:find-sensitive", png),

	// 钉图窗口
	getPinImage: (): Promise<PinImageInfo | null> => ipcRenderer.invoke("pin:get-image"),
	pinReady: (): Promise<void> => ipcRenderer.invoke("pin:ready"),
	/** 拖动由主进程按光标位置移动窗口；-webkit-app-region 会吞掉滚轮和双击，所以不用它。 */
	pinDragStart: (): Promise<void> => ipcRenderer.invoke("pin:drag-start"),
	pinDragMove: (): Promise<void> => ipcRenderer.invoke("pin:drag-move"),
	pinDragEnd: (): Promise<void> => ipcRenderer.invoke("pin:drag-end"),
	/** 以光标为中心缩放，返回相对打开时的比例（百分比）。 */
	pinZoom: (factor: number): Promise<number | null> => ipcRenderer.invoke("pin:zoom", factor),
	pinCopy: (): Promise<void> => ipcRenderer.invoke("pin:copy"),
	pinSave: (): Promise<SaveResult> => ipcRenderer.invoke("pin:save"),

	// 欢迎引导窗口（步骤或权限变化时收到 onboarding:changed，再主动拉取）
	getOnboardingState: (): Promise<OnboardingState | null> => ipcRenderer.invoke("onboarding:get-state"),
	onOnboardingChanged: (callback: () => void) => subscribe("onboarding:changed", callback),
	/** 申请屏幕录制权限：登记到系统列表、打开系统设置，并在系统设置下方显示拖拽授权的小窗。 */
	requestScreenPermission: (): Promise<ScreenPermission> => ipcRenderer.invoke("onboarding:request-permission"),
	/** 授权后重新启动应用，重启后引导停在“完成”这一步。 */
	relaunchForPermission: (): Promise<void> => ipcRenderer.invoke("onboarding:relaunch"),
	/** 关闭引导；capture 为 true 时接着截一张试试。 */
	finishOnboarding: (capture: boolean): Promise<void> => ipcRenderer.invoke("onboarding:finish", capture),

	// 拖拽授权小窗：拖动的是应用本身（.app），放进系统设置的“屏幕录制”列表即可授权
	startPermissionDrag: (): void => ipcRenderer.send("permission-helper:drag"),

	// 滚动截图的进度面板（状态变化时收到 scroll:changed，再主动拉取）
	getScrollState: (): Promise<ScrollCaptureState | null> => ipcRenderer.invoke("scroll:get-state"),
	onScrollChanged: (callback: () => void) => subscribe("scroll:changed", callback),
	/** 拼接预览（JPEG）；previewId 变了再拉取。 */
	getScrollPreview: (): Promise<Uint8Array | null> => ipcRenderer.invoke("scroll:get-preview"),
	finishScroll: (): Promise<void> => ipcRenderer.invoke("scroll:finish"),
	cancelScroll: (): Promise<void> => ipcRenderer.invoke("scroll:cancel"),

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
	setLanguage: (language: LanguageSetting): Promise<SettingsState> =>
		ipcRenderer.invoke("settings:set-language", language),
	/** 主窗口和欢迎引导都能调用。 */
	setOpenAtLogin: (enabled: boolean): Promise<ActionResult> =>
		ipcRenderer.invoke("settings:set-open-at-login", enabled),
	/** macOS 上的选区方式。 */
	setSelectionMode: (mode: SelectionMode): Promise<SettingsState> =>
		ipcRenderer.invoke("settings:set-selection-mode", mode),
	/** 打开欢迎引导；macOS 上没有屏幕录制权限时直接停在授权那一步。 */
	openOnboarding: (): Promise<void> => ipcRenderer.invoke("settings:open-onboarding"),
	/** 在访达 / 资源管理器里打开诊断日志所在的文件夹。 */
	openLogs: (): Promise<void> => ipcRenderer.invoke("settings:open-logs"),

	// 自绘标题栏
	minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
	toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:toggle-maximize"),
	closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("electronAPI", api);
