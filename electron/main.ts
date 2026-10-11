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
	screen,
	Tray,
	type Display,
	type IpcMainInvokeEvent,
	type NativeImage,
} from "electron";
import { captureDisplay } from "./capture";
import { toDevicePixelRect } from "./cropRect";
import type { CaptureFinishPayload, CaptureSessionInfo, SaveResult } from "./ipcTypes";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, "public") : RENDERER_DIST;

const CAPTURE_SHORTCUT = "Alt+C";

type WindowType = "screenshot-region" | "screenshot-preview";

/** 选区窗口在截图前一直是透明的，渲染进程画好之后才显示；超过这个时间仍未就绪则强制显示。 */
const REVEAL_TIMEOUT_MS = 1500;

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
/** 常驻复用的选区窗口，避免每次截图都新建窗口、加载页面。 */
let regionWindow: BrowserWindow | null = null;
let captureSession: CaptureSession | null = null;
let captureSeq = 0;
let captureStarting = false;
let previewWindow: BrowserWindow | null = null;
let previewImage: NativeImage | null = null;

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
		height: Math.min(Math.max(height + 140, 480), workArea.height),
		minWidth: 480,
		minHeight: 320,
		title: "NewPath 编辑",
		autoHideMenuBar: true,
		backgroundColor: "#18181b",
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
	if (!win || win.isDestroyed()) return;
	// 先透明再隐藏：立即消失，下次显示时也不会露出旧画面
	win.setOpacity(0);
	win.hide();
	win.webContents.send("capture:changed");
}

async function savePng(png: Buffer): Promise<SaveResult> {
	const { canceled, filePath } = await dialog.showSaveDialog({
		defaultPath: path.join(app.getPath("pictures"), defaultScreenshotName()),
		filters: [{ name: "PNG 图片", extensions: ["png"] }],
	});
	if (canceled || !filePath) return { saved: false };
	const target = ensurePngExtension(filePath);
	await fs.writeFile(target, png);
	return { saved: true, filePath: target };
}

/** 只接受来自指定窗口的 IPC 调用，防止其他窗口越权。 */
function isFrom(event: IpcMainInvokeEvent, win: BrowserWindow | null | undefined) {
	return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

function toPngBuffer(data: unknown): Buffer | null {
	if (!(data instanceof Uint8Array) || data.byteLength === 0) return null;
	return Buffer.from(data);
}

function registerIpc() {
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
			case "save":
				await savePng(image.toPNG());
				break;
			case "edit":
				openPreviewWindow(image);
				break;
		}
	});

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
		return savePng(png);
	});

	ipcMain.handle("window:close", (event) => {
		BrowserWindow.fromWebContents(event.sender)?.close();
	});
}

// ---------------------------------------------------------------- 托盘与快捷键

function createTray(shortcutRegistered: boolean) {
	const icon = nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC, "icon.png"))
		.resize({ width: 16, height: 16 });
	tray = new Tray(icon);
	tray.setToolTip("NewPath 截图");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: shortcutRegistered ? "截图" : "截图（快捷键被占用）",
				accelerator: shortcutRegistered ? CAPTURE_SHORTCUT : undefined,
				click: () => void startCapture(),
			},
			{ type: "separator" },
			{ label: "退出", role: "quit" },
		]),
	);
	tray.on("click", () => void startCapture());
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	// 再次启动应用时直接进入截图
	app.on("second-instance", () => void startCapture());

	// 托盘应用：关闭所有窗口后继续驻留
	app.on("window-all-closed", () => {});

	app.on("before-quit", () => {
		isQuitting = true;
	});

	app.on("will-quit", () => globalShortcut.unregisterAll());

	app.whenReady().then(() => {
		if (process.platform === "darwin") app.dock?.hide();
		registerIpc();
		const registered = globalShortcut.register(CAPTURE_SHORTCUT, () => void startCapture());
		if (!registered) console.warn(`全局快捷键 ${CAPTURE_SHORTCUT} 注册失败，可能已被其他程序占用`);
		createTray(registered);
		// 提前创建并加载好选区窗口，第一次截图也不用等页面加载
		getRegionWindow();
	});
}
