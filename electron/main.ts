import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	globalShortcut,
	ipcMain,
	Menu,
	nativeImage,
	Notification,
	screen,
	shell,
	Tray,
	type Display,
	type IpcMainInvokeEvent,
	type NativeImage,
} from "electron";
import { captureDisplay } from "./capture";
import { toDevicePixelRect } from "./cropRect";
import type {
	ActionResult,
	AppSettings,
	CaptureAction,
	CaptureFinishPayload,
	CaptureMode,
	CaptureSessionInfo,
	CaptureWindowsInfo,
	DetectedWindow,
	Locale,
	OcrResult,
	PinImageInfo,
	Point,
	SaveResult,
	ScreenshotItem,
	SensitiveResult,
	SettingsState,
} from "./ipcTypes";
import { mt, setMainLocale } from "./i18n";
import { listScreenshots, resolveInDir, saveToLibrary, validateFileName, watchDir } from "./library";
import { isLanguageSetting, resolveLocale } from "./locale";
import { PinManager } from "./pins";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";
import { findSensitiveRegions, type Identity } from "./sensitiveText";
import { loadSettings, saveSettings } from "./settings";
import { WindowListHelper } from "./windowList";
import { toDisplayLocalPoint, toDisplayLocalWindows } from "./windowRects";
import { recognizeWithWindowsOcr } from "./windowsOcr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, "public") : RENDERER_DIST;

const APP_ID = "com.newpath.screenshot";

/** Windows 开机自启时带上这个参数，启动后只驻留托盘、不弹主界面。 */
const HIDDEN_ARG = "--hidden";
/** 开发模式下注册的会是裸的 electron.exe；Linux 上 Electron 不支持登录项。 */
const OPEN_AT_LOGIN_SUPPORTED = app.isPackaged && process.platform !== "linux";

type WindowType = "main" | "screenshot-region" | "screenshot-preview" | "screenshot-pin";

/** 选区窗口在截图前一直是透明的，渲染进程画好之后才显示；超过这个时间仍未就绪则强制显示。 */
const REVEAL_TIMEOUT_MS = 1500;
/** 从主界面发起截图时，等主窗口真正从屏幕上消失再截图（Windows 的隐藏动画约 100–200ms）。 */
const HIDE_BEFORE_CAPTURE_MS = 250;

interface CaptureSession {
	id: number;
	/** 原始位图，裁剪时使用。 */
	image: NativeImage;
	/** 给选区窗口显示用的 JPEG，编码比 PNG 快得多。 */
	previewJpeg: Buffer;
	display: Display;
	revealed: boolean;
	startedAt: number;
	mode: CaptureMode;
	/** 拼接模式下发起截图的编辑窗口，截图结束后把它恢复出来。 */
	stitchTarget: BrowserWindow | null;
	/** 截图时屏幕上的窗口，比画面晚到；null 表示还没枚举完。 */
	windows: DetectedWindow[] | null;
	/** 截图开始时的光标位置（选区窗口里的 CSS 像素）。 */
	cursor: Point;
}

const CAPTURE_ACTIONS: readonly CaptureAction[] = ["copy", "copy-path", "save", "edit", "pin", "stitch"];

let tray: Tray | null = null;
let isQuitting = false;
let mainWindow: BrowserWindow | null = null;
/** 常驻复用的选区窗口，避免每次截图都新建窗口、加载页面。 */
let regionWindow: BrowserWindow | null = null;
let captureSession: CaptureSession | null = null;
let captureSeq = 0;
let captureStarting = false;
/** 截图是从主界面发起的：结束后把主窗口恢复出来。 */
let restoreMainAfterCapture = false;
let previewWindow: BrowserWindow | null = null;
let previewImage: NativeImage | null = null;
/** "再截一张"得到的图片，等编辑窗口来取。 */
let pendingStitch: NativeImage | null = null;

const windowLister = new WindowListHelper();
const pins = new PinManager((options) => createWindow("screenshot-pin", options), () => refreshTrayMenu());

let settingsFile = "";
let settings: AppSettings;
let locale: Locale = "zh-CN";
let shortcutRegistered = false;
/** 设置里正在录制快捷键时暂停全局快捷键，否则按下当前快捷键会直接开始截图。 */
let shortcutSuspended = false;
let stopWatching: (() => void) | null = null;

// ---------------------------------------------------------------- 窗口

function createWindow(windowType: WindowType, options: Electron.BrowserWindowConstructorOptions) {
	const win = new BrowserWindow({
		show: false,
		...options,
		webPreferences: {
			...options.webPreferences,
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			// vite-plugin-electron 把 preload 打包成 CommonJS；沙盒模式下它按普通脚本执行
			sandbox: true,
		},
	});

	// 渲染进程禁止打开新窗口或跳转到外部页面
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	win.webContents.on("will-navigate", (event) => event.preventDefault());

	// lang 让页面首帧就用对的语言；之后切换语言靠 locale:changed 通知
	if (VITE_DEV_SERVER_URL) {
		const url = new URL(VITE_DEV_SERVER_URL);
		url.searchParams.set("windowType", windowType);
		url.searchParams.set("lang", locale);
		void win.loadURL(url.toString());
	} else {
		void win.loadFile(path.join(RENDERER_DIST, "index.html"), { query: { windowType, lang: locale } });
	}
	return win;
}

/** showWhenReady 为 false 时只创建、加载好，不显示（开机自启时用）。 */
function getMainWindow(showWhenReady = true) {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

	const win = createWindow("main", {
		width: 1100,
		height: 720,
		minWidth: 880,
		minHeight: 520,
		// 无边框，标题栏由渲染进程自绘；不用 transparent，Windows 11 会自动加圆角
		frame: false,
		title: "NewPath",
		backgroundColor: "#F2F2F7",
	});
	if (showWhenReady) win.once("ready-to-show", () => win.show());
	// 关闭按钮只是隐藏到托盘，应用继续驻留
	win.on("close", (event) => {
		if (isQuitting) return;
		event.preventDefault();
		win.hide();
	});
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});
	mainWindow = win;
	return win;
}

function showMainWindow() {
	const win = getMainWindow();
	if (win.webContents.isLoading()) {
		// 正常启动时 ready-to-show 会自动显示；开机自启时没有注册，这里补上（重复 show 无害）
		win.once("ready-to-show", () => win.show());
		return;
	}
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

function notifyMain(channel: string) {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

function getRegionWindow() {
	if (regionWindow && !regionWindow.isDestroyed()) return regionWindow;

	const win = createWindow("screenshot-region", {
		frame: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		hasShadow: false,
		enableLargerThanScreen: true,
		backgroundColor: "#000000",
		// 隐藏状态下也要能及时处理新会话
		webPreferences: { backgroundThrottling: false },
	});
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	// Alt+F4 等关闭操作只当作取消，窗口留着下次复用
	win.on("close", (event) => {
		if (isQuitting) return;
		event.preventDefault();
		closeCaptureSession();
	});
	win.on("closed", () => {
		if (regionWindow === win) regionWindow = null;
		captureSession = null;
	});
	regionWindow = win;
	return win;
}

function openPreviewWindow(image: NativeImage) {
	previewImage = image;
	if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();

	const { width, height } = image.getSize();
	const { workArea, scaleFactor } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	// 工具栏一行放得下所有按钮需要约 1000px；窗口按截图的逻辑尺寸留出工具栏和缩放条的位置
	const win = createWindow("screenshot-preview", {
		width: Math.min(Math.max(Math.round(width / scaleFactor) + 160, 1000), workArea.width),
		height: Math.min(Math.max(Math.round(height / scaleFactor) + 240, 640), workArea.height),
		minWidth: Math.min(900, workArea.width),
		minHeight: Math.min(560, workArea.height),
		frame: false,
		title: mt().previewWindowTitle,
		backgroundColor: "#F2F2F7",
	});
	win.once("ready-to-show", () => win.show());
	win.on("closed", () => {
		if (previewWindow === win) {
			previewWindow = null;
			previewImage = null;
			pendingStitch = null;
		}
	});
	previewWindow = win;
}

function showWindow(win: BrowserWindow | null) {
	if (!win || win.isDestroyed()) return;
	win.show();
	win.focus();
}

// ---------------------------------------------------------------- 截图流程

async function startCapture(mode: CaptureMode = "capture", stitchTarget: BrowserWindow | null = null) {
	if (captureSession) {
		regionWindow?.focus();
		return;
	}
	if (captureStarting) return;
	captureStarting = true;
	const startedAt = performance.now();
	try {
		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		// 枚举窗口和截屏同时进行，不拖慢选区窗口的显示
		const windowsPromise = windowLister.list(process.pid);
		const image = await captureDisplay(display);
		if (!image) {
			restoreMainWindow();
			dialog.showErrorBox(
				mt().captureFailedTitle,
				process.platform === "darwin" ? mt().captureFailedMacPermission : mt().captureFailedRetry,
			);
			return;
		}

		const session: CaptureSession = {
			id: ++captureSeq,
			image,
			previewJpeg: image.toJPEG(92),
			display,
			revealed: false,
			startedAt,
			mode,
			stitchTarget,
			windows: null,
			cursor: toDisplayLocalPoint(cursor, display.bounds),
		};
		captureSession = session;
		void windowsPromise.then((windows) => {
			if (captureSession !== session) return;
			session.windows = toDisplayLocalWindows(windows, display.bounds, (rect) => screen.screenToDipRect(null, rect));
			regionWindow?.webContents.send("capture:windows");
		});

		// 先以完全透明的状态显示，等渲染进程画好截图再变为可见，避免黑屏闪烁或残留上一次的画面
		const win = getRegionWindow();
		win.setOpacity(0);
		win.setBounds(display.bounds);
		win.showInactive();
		// Windows 多显示器缩放比例不同时，首次设置的坐标可能被换算错，显示后再校正一次
		win.setBounds(display.bounds);
		win.webContents.send("capture:changed");
		setTimeout(() => revealRegionWindow(session.id), REVEAL_TIMEOUT_MS);
	} finally {
		captureStarting = false;
	}
}

/** 主界面的"开始截图"：先把主窗口藏起来，免得它出现在截图里。 */
async function startCaptureFromMain() {
	if (captureSession || captureStarting) return;
	const win = mainWindow;
	if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
		restoreMainAfterCapture = true;
		win.hide();
		await new Promise((resolve) => setTimeout(resolve, HIDE_BEFORE_CAPTURE_MS));
	}
	await startCapture();
}

/** 编辑窗口的"再截一张"：先藏起编辑窗口，截完（或取消）再恢复。 */
async function startStitchCapture() {
	const target = previewWindow;
	if (!target || target.isDestroyed() || captureSession || captureStarting) return;
	target.hide();
	await new Promise((resolve) => setTimeout(resolve, HIDE_BEFORE_CAPTURE_MS));
	await startCapture("stitch", target);
	// 截图失败时没有会话，直接把编辑窗口恢复出来（await 之后要重新读取，TS 的收窄在这里不成立）
	const session = captureSession as CaptureSession | null;
	if (session?.stitchTarget !== target) showWindow(target);
}

function restoreMainWindow() {
	if (!restoreMainAfterCapture) return;
	restoreMainAfterCapture = false;
	showMainWindow();
}

function revealRegionWindow(sessionId: number) {
	const session = captureSession;
	const win = regionWindow;
	if (!session || session.id !== sessionId || session.revealed || !win || win.isDestroyed()) return;
	session.revealed = true;
	if (VITE_DEV_SERVER_URL) console.log(`[capture] 按下快捷键到显示选区：${Math.round(performance.now() - session.startedAt)}ms`);
	win.setOpacity(1);
	win.moveTop();
	win.focus();
}

function closeCaptureSession() {
	const session = captureSession;
	captureSession = null;
	const win = regionWindow;
	if (win && !win.isDestroyed()) {
		// 先透明再隐藏：立即消失，下次显示时也不会露出旧画面
		win.setOpacity(0);
		win.hide();
		win.webContents.send("capture:changed");
	}
	restoreMainWindow();
	if (session?.stitchTarget) showWindow(session.stitchTarget);
}

/** 另存为：弹出保存对话框。 */
async function savePngAs(png: Buffer): Promise<SaveResult> {
	const { canceled, filePath } = await dialog.showSaveDialog({
		defaultPath: path.join(settings.saveDir, defaultScreenshotName()),
		filters: [{ name: mt().pngFilterName, extensions: ["png"] }],
	});
	if (canceled || !filePath) return { saved: false };
	const target = ensurePngExtension(filePath);
	await fs.writeFile(target, png);
	return { saved: true, filePath: target };
}

/** 直接保存到截图库。 */
async function savePngToLibrary(png: Buffer): Promise<SaveResult> {
	try {
		const filePath = await saveToLibrary(settings.saveDir, defaultScreenshotName(), png);
		return { saved: true, filePath };
	} catch (error) {
		dialog.showErrorBox(mt().saveFailedTitle, mt().saveFailedMessage(settings.saveDir, String(error)));
		return { saved: false };
	}
}

/** 截图窗口里直接保存时没有界面可以反馈，用系统通知告诉用户存到了哪里。 */
function notifySaved(filePath: string, title = mt().notifySaved) {
	if (!Notification.isSupported()) return;
	const notification = new Notification({ title, body: path.basename(filePath), silent: true });
	notification.on("click", () => shell.showItemInFolder(filePath));
	notification.show();
}

// ---------------------------------------------------------------- 设置与快捷键

/** Windows 上登录项按“路径 + 参数”区分，读写都要带上同样的参数。 */
function loginItemOptions() {
	return process.platform === "win32" ? { args: [HIDDEN_ARG] } : {};
}

function getSettingsState(): SettingsState {
	return {
		...settings,
		shortcutRegistered,
		locale,
		openAtLogin: OPEN_AT_LOGIN_SUPPORTED && app.getLoginItemSettings(loginItemOptions()).openAtLogin,
		openAtLoginSupported: OPEN_AT_LOGIN_SUPPORTED,
	};
}

/** 这次是不是开机自启拉起来的。 */
function launchedAtLogin() {
	if (process.argv.includes(HIDDEN_ARG)) return true;
	return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin;
}

function setOpenAtLogin(enabled: boolean): ActionResult {
	if (!OPEN_AT_LOGIN_SUPPORTED) return { ok: false, reason: mt().openAtLoginUnsupported };
	app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: enabled });
	return { ok: true };
}

/** 按设置和系统语言算出界面语言，同步到托盘和所有窗口。 */
function applyLocale() {
	const systemTag = app.getPreferredSystemLanguages()[0] ?? app.getLocale();
	locale = resolveLocale(settings.language, systemTag);
	setMainLocale(locale);
	tray?.setToolTip(mt().trayTooltip);
	refreshTrayMenu();
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send("locale:changed");
}

async function persistSettings() {
	try {
		await saveSettings(settingsFile, settings);
	} catch (error) {
		console.warn("保存设置失败", error);
	}
}

function tryRegister(accelerator: string) {
	try {
		return globalShortcut.register(accelerator, () => void startCapture());
	} catch {
		// 格式不合法的加速键会直接抛错
		return false;
	}
}

/** 按当前设置（重新）注册全局快捷键。 */
function syncShortcut() {
	globalShortcut.unregisterAll();
	if (!shortcutSuspended) {
		shortcutRegistered = tryRegister(settings.captureShortcut);
		if (!shortcutRegistered) console.warn(`全局快捷键 ${settings.captureShortcut} 注册失败，可能已被其他程序占用`);
	}
	refreshTrayMenu();
}

async function changeShortcut(accelerator: string): Promise<ActionResult> {
	// 先试着注册一次，确认可用后再写入设置；失败时恢复原来的快捷键
	globalShortcut.unregisterAll();
	const available = tryRegister(accelerator);
	globalShortcut.unregisterAll();
	if (!available) {
		syncShortcut();
		return { ok: false, reason: mt().shortcutUnavailable(accelerator) };
	}
	settings = { ...settings, captureShortcut: accelerator };
	shortcutRegistered = true;
	syncShortcut();
	await persistSettings();
	return { ok: true };
}

function startWatching() {
	stopWatching?.();
	stopWatching = watchDir(settings.saveDir, () => notifyMain("library:changed"));
}

async function chooseSaveDir(): Promise<SettingsState | null> {
	const options: Electron.OpenDialogOptions = {
		title: mt().chooseSaveDirTitle,
		defaultPath: settings.saveDir,
		properties: ["openDirectory", "createDirectory"],
	};
	const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
	const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
	if (canceled || !filePaths[0]) return null;
	settings = { ...settings, saveDir: filePaths[0] };
	await persistSettings();
	startWatching();
	notifyMain("library:changed");
	return getSettingsState();
}

// ---------------------------------------------------------------- IPC

/** 只接受来自指定窗口的 IPC 调用，防止其他窗口越权。 */
function isFrom(event: IpcMainInvokeEvent, win: BrowserWindow | null | undefined) {
	return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

/** 注册只允许主窗口调用的 IPC。 */
function handleMain(channel: string, handler: (...args: unknown[]) => unknown) {
	ipcMain.handle(channel, (event, ...args: unknown[]) => {
		if (!isFrom(event, mainWindow)) throw new Error(`${channel} 只能由主窗口调用`);
		return handler(...args);
	});
}

function toPngBuffer(data: unknown): Buffer | null {
	if (!(data instanceof Uint8Array) || data.byteLength === 0) return null;
	return Buffer.from(data);
}

function parseFinishPayload(payload: unknown): CaptureFinishPayload | null {
	if (!payload || typeof payload !== "object") return null;
	const { rect, action } = payload as Record<string, unknown>;
	if (!CAPTURE_ACTIONS.includes(action as CaptureAction) || !rect || typeof rect !== "object") return null;
	const { x, y, width, height } = rect as Record<string, unknown>;
	if (![x, y, width, height].every((value) => typeof value === "number")) return null;
	return { rect: { x, y, width, height } as CaptureFinishPayload["rect"], action: action as CaptureAction };
}

/** 本机用户名和主机名，智能打码时一并遮住。 */
function localIdentity(): Identity {
	const userNames = new Set<string>();
	const hostNames = new Set<string>();
	try {
		userNames.add(os.userInfo().username);
	} catch {
		// 某些环境下拿不到用户信息
	}
	for (const name of [process.env.USERNAME, process.env.USER, path.basename(os.homedir())]) if (name) userNames.add(name);
	for (const name of [os.hostname(), process.env.COMPUTERNAME]) {
		if (!name) continue;
		hostNames.add(name);
		hostNames.add(name.split(".")[0]);
	}
	return { userNames: [...userNames], hostNames: [...hostNames] };
}

function recognizeText(png: Buffer): Promise<OcrResult> {
	if (process.platform !== "win32") return Promise.resolve({ ok: false, reason: mt().ocrUnsupported });
	return recognizeWithWindowsOcr(png);
}

/** 截图库文件操作的统一入口：校验文件名，把异常转成给用户看的提示。 */
async function withLibraryFile(name: unknown, action: (filePath: string) => unknown): Promise<ActionResult> {
	const filePath = resolveInDir(settings.saveDir, name);
	if (!filePath) return { ok: false, reason: mt().invalidFileName };
	try {
		await fs.access(filePath);
		await action(filePath);
		return { ok: true };
	} catch (error) {
		// 带 code 的是系统错误（英文提示），换成简短的本地化提示；其余是上面主动抛出的提示，原样返回
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { ok: false, reason: mt().fileNotFound };
		return { ok: false, reason: code ? mt().operationFailed(code) : (error as Error).message };
	}
}

async function createThumbnail(filePath: string): Promise<string | null> {
	const size = { width: 240, height: 160 };
	let image: NativeImage;
	try {
		image = await nativeImage.createThumbnailFromPath(filePath, size);
	} catch {
		// Linux 不支持系统缩略图，自己缩放
		image = nativeImage.createFromPath(filePath);
		if (!image.isEmpty()) image = image.resize({ width: size.width });
	}
	return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(80).toString("base64")}`;
}

function registerIpc() {
	// 选区窗口
	ipcMain.handle("capture:get-session", (event): CaptureSessionInfo | null => {
		const session = captureSession;
		if (!session || !isFrom(event, regionWindow)) return null;
		return {
			id: session.id,
			imageBytes: session.previewJpeg,
			mimeType: "image/jpeg",
			scaleFactor: session.display.scaleFactor,
			mode: session.mode,
			cursor: session.cursor,
		};
	});

	ipcMain.handle("capture:get-windows", (event): CaptureWindowsInfo | null => {
		const session = captureSession;
		if (!session?.windows || !isFrom(event, regionWindow)) return null;
		return { sessionId: session.id, windows: session.windows };
	});

	ipcMain.handle("capture:ready", (event, sessionId: unknown) => {
		if (isFrom(event, regionWindow) && typeof sessionId === "number") revealRegionWindow(sessionId);
	});

	ipcMain.handle("capture:cancel", (event) => {
		if (isFrom(event, regionWindow)) closeCaptureSession();
	});

	ipcMain.handle("capture:finish", async (event, data: unknown) => {
		const session = captureSession;
		const payload = parseFinishPayload(data);
		if (!session || !payload || !isFrom(event, regionWindow)) return;
		// 拼接模式只接受 stitch，普通截图不接受 stitch
		if ((payload.action === "stitch") !== (session.mode === "stitch")) return;
		const { scaleFactor, bounds } = session.display;
		const crop = toDevicePixelRect(payload.rect, scaleFactor, session.image.getSize());
		closeCaptureSession();
		if (!crop) return;

		const image = session.image.crop(crop);
		switch (payload.action) {
			case "copy":
				clipboard.writeImage(image);
				break;
			case "save": {
				const result = await savePngToLibrary(image.toPNG());
				if (result.saved) notifySaved(result.filePath);
				break;
			}
			case "copy-path": {
				const result = await savePngToLibrary(image.toPNG());
				if (!result.saved) break;
				clipboard.writeText(result.filePath);
				notifySaved(result.filePath, mt().notifySavedPathCopied);
				break;
			}
			case "edit":
				openPreviewWindow(image);
				break;
			case "pin":
				// 钉在截图时的原位置
				pins.open(image, scaleFactor, { x: bounds.x + crop.x / scaleFactor, y: bounds.y + crop.y / scaleFactor });
				break;
			case "stitch": {
				const target = session.stitchTarget;
				if (!target || target.isDestroyed() || target !== previewWindow) break;
				pendingStitch = image;
				target.webContents.send("preview:stitch-added");
				break;
			}
		}
	});

	// 编辑窗口
	ipcMain.handle("preview:get-image", (event) => {
		if (!isFrom(event, previewWindow) || !previewImage) return null;
		return previewImage.toDataURL();
	});

	ipcMain.handle("preview:start-stitch", (event) => {
		if (isFrom(event, previewWindow)) void startStitchCapture();
	});

	ipcMain.handle("preview:take-stitch", (event) => {
		if (!isFrom(event, previewWindow) || !pendingStitch) return null;
		const dataUrl = pendingStitch.toDataURL();
		pendingStitch = null;
		return dataUrl;
	});

	ipcMain.handle("image:pin", (event, data: unknown) => {
		const png = toPngBuffer(data);
		const win = previewWindow;
		if (!win || !isFrom(event, win) || !png) return;
		const image = nativeImage.createFromBuffer(png);
		if (image.isEmpty()) return;
		pins.open(image, screen.getDisplayMatching(win.getBounds()).scaleFactor, null);
	});

	ipcMain.handle("text:copy", (event, text: unknown) => {
		if (isFrom(event, previewWindow) && typeof text === "string") clipboard.writeText(text);
	});

	ipcMain.handle("ocr:recognize", async (event, data: unknown): Promise<OcrResult> => {
		const png = toPngBuffer(data);
		if (!isFrom(event, previewWindow) || !png) return { ok: false, reason: mt().invalidImageData };
		return recognizeText(png);
	});

	ipcMain.handle("ocr:find-sensitive", async (event, data: unknown): Promise<SensitiveResult> => {
		const png = toPngBuffer(data);
		if (!isFrom(event, previewWindow) || !png) return { ok: false, reason: mt().invalidImageData };
		const result = await recognizeText(png);
		if (!result.ok) return result;
		const size = nativeImage.createFromBuffer(png).getSize();
		return { ok: true, regions: findSensitiveRegions(result.lines, localIdentity(), size) };
	});

	ipcMain.handle("image:copy", (event, data: unknown) => {
		const png = toPngBuffer(data);
		if (!isFrom(event, previewWindow) || !png) return;
		clipboard.writeImage(nativeImage.createFromBuffer(png));
	});

	ipcMain.handle("image:save", async (event, data: unknown): Promise<SaveResult> => {
		const png = toPngBuffer(data);
		if (!isFrom(event, previewWindow) || !png) return { saved: false };
		return savePngToLibrary(png);
	});

	ipcMain.handle("image:save-as", async (event, data: unknown): Promise<SaveResult> => {
		const png = toPngBuffer(data);
		if (!isFrom(event, previewWindow) || !png) return { saved: false };
		return savePngAs(png);
	});

	// 钉图窗口（只接受来自钉图窗口自己的调用）
	ipcMain.handle("pin:get-image", (event): PinImageInfo | null => {
		const record = pins.fromEvent(event);
		return record ? pins.imageInfo(record) : null;
	});

	ipcMain.handle("pin:ready", (event) => {
		const record = pins.fromEvent(event);
		if (record) pins.markReady(record);
	});

	ipcMain.handle("pin:drag-start", (event) => {
		const record = pins.fromEvent(event);
		if (record) pins.dragStart(record);
	});

	ipcMain.handle("pin:drag-move", (event) => {
		const record = pins.fromEvent(event);
		if (record) pins.dragMove(record);
	});

	ipcMain.handle("pin:drag-end", (event) => {
		const record = pins.fromEvent(event);
		if (record) pins.dragEnd(record);
	});

	ipcMain.handle("pin:zoom", (event, factor: unknown): number | null => {
		const record = pins.fromEvent(event);
		if (!record || typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return null;
		return pins.zoom(record, factor);
	});

	ipcMain.handle("pin:copy", (event) => {
		const record = pins.fromEvent(event);
		if (record) clipboard.writeImage(record.image);
	});

	ipcMain.handle("pin:save", async (event): Promise<SaveResult> => {
		const record = pins.fromEvent(event);
		if (!record) return { saved: false };
		const result = await savePngToLibrary(record.image.toPNG());
		if (result.saved) notifySaved(result.filePath);
		return result;
	});

	// 主窗口：截图库
	handleMain("capture:start", () => startCaptureFromMain());

	handleMain("library:list", (): Promise<ScreenshotItem[]> => listScreenshots(settings.saveDir));

	handleMain("library:thumbnail", async (name) => {
		const filePath = resolveInDir(settings.saveDir, name);
		return filePath ? createThumbnail(filePath) : null;
	});

	handleMain("library:copy-image", (name) =>
		withLibraryFile(name, (filePath) => {
			const image = nativeImage.createFromPath(filePath);
			if (image.isEmpty()) throw new Error(mt().cannotReadImage);
			clipboard.writeImage(image);
		}),
	);

	handleMain("library:copy-path", (name) => withLibraryFile(name, (filePath) => clipboard.writeText(filePath)));

	handleMain("library:reveal", (name) => withLibraryFile(name, (filePath) => shell.showItemInFolder(filePath)));

	handleMain("library:edit", (name) =>
		withLibraryFile(name, (filePath) => {
			const image = nativeImage.createFromPath(filePath);
			if (image.isEmpty()) throw new Error(mt().cannotReadImage);
			openPreviewWindow(image);
		}),
	);

	handleMain("library:delete", (name) => withLibraryFile(name, (filePath) => shell.trashItem(filePath)));

	handleMain("library:rename", (name, newName) =>
		withLibraryFile(name, async (filePath) => {
			const checked = validateFileName(newName, path.basename(filePath));
			if (!checked.ok) throw new Error(checked.reason);
			const target = path.join(settings.saveDir, checked.name);
			if (target === filePath) return;
			// 只改大小写时目标在 Windows 上"已存在"，允许直接改名
			const sameFile = target.toLowerCase() === filePath.toLowerCase();
			if (!sameFile && (await fs.access(target).then(() => true, () => false))) {
				throw new Error(mt().fileNameExists(checked.name));
			}
			await fs.rename(filePath, target);
		}),
	);

	// 主窗口：设置
	handleMain("settings:get", () => getSettingsState());

	handleMain("settings:set-shortcut", async (accelerator): Promise<ActionResult> => {
		if (typeof accelerator !== "string" || !accelerator) return { ok: false, reason: mt().invalidShortcut };
		return changeShortcut(accelerator);
	});

	handleMain("settings:suspend-shortcut", (suspended) => {
		shortcutSuspended = suspended === true;
		syncShortcut();
	});

	handleMain("settings:choose-save-dir", () => chooseSaveDir());

	handleMain("settings:open-save-dir", async () => {
		await fs.mkdir(settings.saveDir, { recursive: true });
		await shell.openPath(settings.saveDir);
	});

	handleMain("settings:set-language", async (language): Promise<SettingsState> => {
		if (isLanguageSetting(language) && language !== settings.language) {
			settings = { ...settings, language };
			applyLocale();
			await persistSettings();
		}
		return getSettingsState();
	});

	handleMain("settings:set-open-at-login", (enabled): ActionResult => {
		if (typeof enabled !== "boolean") return { ok: false, reason: mt().invalidArgument };
		return setOpenAtLogin(enabled);
	});

	// 所有窗口：界面语言
	ipcMain.handle("locale:get", (): Locale => locale);

	// 所有窗口：自绘标题栏的按钮
	ipcMain.handle("window:minimize", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.minimize();
	});

	ipcMain.handle("window:toggle-maximize", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win?.isMaximizable()) return;
		if (win.isMaximized()) win.unmaximize();
		else win.maximize();
	});

	ipcMain.handle("window:close", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.close();
	});
}

// ---------------------------------------------------------------- 托盘

function createTray() {
	const icon = nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC, "icon.png"))
		.resize({ width: 16, height: 16 });
	tray = new Tray(icon);
	tray.setToolTip(mt().trayTooltip);
	tray.on("click", () => void startCapture());
	refreshTrayMenu();
}

function refreshTrayMenu() {
	if (!tray || tray.isDestroyed()) return;
	const usable = shortcutRegistered && !shortcutSuspended;
	const m = mt();
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: m.trayOpenMain, click: showMainWindow },
			{
				label: usable ? m.trayCapture : m.trayCaptureNoShortcut,
				accelerator: usable ? settings.captureShortcut : undefined,
				click: () => void startCapture(),
			},
			{ label: m.trayCloseAllPins, enabled: pins.count > 0, click: () => pins.closeAll() },
			{ type: "separator" },
			{ label: m.trayQuit, role: "quit" },
		]),
	);
}

// ---------------------------------------------------------------- 启动

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	// 再次启动应用时打开主界面
	app.on("second-instance", () => showMainWindow());

	// 托盘应用：关闭所有窗口后继续驻留
	app.on("window-all-closed", () => {});

	app.on("before-quit", () => {
		isQuitting = true;
	});

	app.on("will-quit", () => {
		globalShortcut.unregisterAll();
		stopWatching?.();
		windowLister.dispose();
	});

	app.whenReady().then(async () => {
		if (process.platform === "darwin") app.dock?.hide();
		if (process.platform === "win32") app.setAppUserModelId(APP_ID);

		settingsFile = path.join(app.getPath("userData"), "settings.json");
		settings = await loadSettings(settingsFile, {
			captureShortcut: "Alt+C",
			saveDir: path.join(app.getPath("pictures"), "NewPath"),
			language: "system",
		});
		// 这时还没有窗口和托盘，只算出语言
		applyLocale();

		registerIpc();
		createTray();
		syncShortcut();
		startWatching();
		// 窗口枚举进程启动要一两秒，提前拉起来
		windowLister.start();
		// 提前创建并加载好选区窗口，第一次截图也不用等页面加载
		getRegionWindow();
		// 开机自启时只驻留托盘；主窗口照样提前加载，之后打开不用等
		getMainWindow(!launchedAtLogin());
	});
}
