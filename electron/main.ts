import fs from "node:fs/promises";
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
	CaptureFinishPayload,
	CaptureSessionInfo,
	SaveResult,
	ScreenshotItem,
	SettingsState,
} from "./ipcTypes";
import { listScreenshots, resolveInDir, saveToLibrary, validateFileName, watchDir } from "./library";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";
import { loadSettings, saveSettings } from "./settings";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, "public") : RENDERER_DIST;

const APP_ID = "com.newpath.screenshot";

type WindowType = "main" | "screenshot-region" | "screenshot-preview";

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
}

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

let settingsFile = "";
let settings: AppSettings;
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

	if (VITE_DEV_SERVER_URL) {
		const url = new URL(VITE_DEV_SERVER_URL);
		url.searchParams.set("windowType", windowType);
		void win.loadURL(url.toString());
	} else {
		void win.loadFile(path.join(RENDERER_DIST, "index.html"), { query: { windowType } });
	}
	return win;
}

function getMainWindow() {
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
	win.once("ready-to-show", () => win.show());
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
	if (win.webContents.isLoading()) return; // ready-to-show 时会自动显示
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
	const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
	const win = createWindow("screenshot-preview", {
		width: Math.min(Math.max(width + 80, 720), workArea.width),
		height: Math.min(Math.max(height + 160, 480), workArea.height),
		minWidth: 560,
		minHeight: 360,
		frame: false,
		title: "NewPath 编辑",
		backgroundColor: "#F2F2F7",
	});
	win.once("ready-to-show", () => win.show());
	win.on("closed", () => {
		if (previewWindow === win) {
			previewWindow = null;
			previewImage = null;
		}
	});
	previewWindow = win;
}

// ---------------------------------------------------------------- 截图流程

async function startCapture() {
	if (captureSession) {
		regionWindow?.focus();
		return;
	}
	if (captureStarting) return;
	captureStarting = true;
	const startedAt = performance.now();
	try {
		const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
		const image = await captureDisplay(display);
		if (!image) {
			restoreMainWindow();
			dialog.showErrorBox(
				"无法截图",
				process.platform === "darwin"
					? "请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 NewPath，然后重启应用。"
					: "未能获取屏幕画面，请重试。",
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
		};
		captureSession = session;

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
	captureSession = null;
	const win = regionWindow;
	if (win && !win.isDestroyed()) {
		// 先透明再隐藏：立即消失，下次显示时也不会露出旧画面
		win.setOpacity(0);
		win.hide();
		win.webContents.send("capture:changed");
	}
	restoreMainWindow();
}

/** 另存为：弹出保存对话框。 */
async function savePngAs(png: Buffer): Promise<SaveResult> {
	const { canceled, filePath } = await dialog.showSaveDialog({
		defaultPath: path.join(settings.saveDir, defaultScreenshotName()),
		filters: [{ name: "PNG 图片", extensions: ["png"] }],
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
		dialog.showErrorBox("保存失败", `无法写入 ${settings.saveDir}\n${String(error)}`);
		return { saved: false };
	}
}

/** 截图窗口里直接保存时没有界面可以反馈，用系统通知告诉用户存到了哪里。 */
function notifySaved(filePath: string) {
	if (!Notification.isSupported()) return;
	const notification = new Notification({ title: "截图已保存", body: path.basename(filePath), silent: true });
	notification.on("click", () => shell.showItemInFolder(filePath));
	notification.show();
}

// ---------------------------------------------------------------- 设置与快捷键

function getSettingsState(): SettingsState {
	return { ...settings, shortcutRegistered };
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
		return { ok: false, reason: `${accelerator} 无法使用，可能已被其他程序占用` };
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
		title: "选择截图保存位置",
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

/** 截图库文件操作的统一入口：校验文件名，把异常转成给用户看的提示。 */
async function withLibraryFile(name: unknown, action: (filePath: string) => unknown): Promise<ActionResult> {
	const filePath = resolveInDir(settings.saveDir, name);
	if (!filePath) return { ok: false, reason: "文件名无效" };
	try {
		await fs.access(filePath);
		await action(filePath);
		return { ok: true };
	} catch (error) {
		// 带 code 的是系统错误（英文提示），换成简短的中文；其余是上面主动抛出的提示，原样返回
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { ok: false, reason: "文件已不存在" };
		return { ok: false, reason: code ? `操作失败（${code}）` : (error as Error).message };
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
		};
	});

	ipcMain.handle("capture:ready", (event, sessionId: unknown) => {
		if (isFrom(event, regionWindow) && typeof sessionId === "number") revealRegionWindow(sessionId);
	});

	ipcMain.handle("capture:cancel", (event) => {
		if (isFrom(event, regionWindow)) closeCaptureSession();
	});

	ipcMain.handle("capture:finish", async (event, payload: CaptureFinishPayload) => {
		const session = captureSession;
		if (!session || !isFrom(event, regionWindow)) return;
		const crop = toDevicePixelRect(payload.rect, session.display.scaleFactor, session.image.getSize());
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
			case "edit":
				openPreviewWindow(image);
				break;
		}
	});

	// 编辑窗口
	ipcMain.handle("preview:get-image", (event) => {
		if (!isFrom(event, previewWindow) || !previewImage) return null;
		return previewImage.toDataURL();
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
			if (image.isEmpty()) throw new Error("无法读取图片");
			clipboard.writeImage(image);
		}),
	);

	handleMain("library:copy-path", (name) => withLibraryFile(name, (filePath) => clipboard.writeText(filePath)));

	handleMain("library:reveal", (name) => withLibraryFile(name, (filePath) => shell.showItemInFolder(filePath)));

	handleMain("library:edit", (name) =>
		withLibraryFile(name, (filePath) => {
			const image = nativeImage.createFromPath(filePath);
			if (image.isEmpty()) throw new Error("无法读取图片");
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
				throw new Error(`已存在同名文件 ${checked.name}`);
			}
			await fs.rename(filePath, target);
		}),
	);

	// 主窗口：设置
	handleMain("settings:get", () => getSettingsState());

	handleMain("settings:set-shortcut", async (accelerator): Promise<ActionResult> => {
		if (typeof accelerator !== "string" || !accelerator) return { ok: false, reason: "快捷键无效" };
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

	// 所有窗口：自绘标题栏的按钮
	ipcMain.handle("window:minimize", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.minimize();
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
	tray.setToolTip("NewPath 截图");
	tray.on("click", () => void startCapture());
	refreshTrayMenu();
}

function refreshTrayMenu() {
	if (!tray) return;
	const usable = shortcutRegistered && !shortcutSuspended;
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "打开主界面", click: showMainWindow },
			{
				label: usable ? "截图" : "截图（快捷键不可用）",
				accelerator: usable ? settings.captureShortcut : undefined,
				click: () => void startCapture(),
			},
			{ type: "separator" },
			{ label: "退出", role: "quit" },
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
	});

	app.whenReady().then(async () => {
		if (process.platform === "darwin") app.dock?.hide();
		if (process.platform === "win32") app.setAppUserModelId(APP_ID);

		settingsFile = path.join(app.getPath("userData"), "settings.json");
		settings = await loadSettings(settingsFile, {
			captureShortcut: "Alt+C",
			saveDir: path.join(app.getPath("pictures"), "NewPath"),
		});

		registerIpc();
		createTray();
		syncShortcut();
		startWatching();
		// 提前创建并加载好选区窗口，第一次截图也不用等页面加载
		getRegionWindow();
		getMainWindow();
	});
}
