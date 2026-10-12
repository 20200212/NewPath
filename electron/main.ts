import { execFile } from "node:child_process";
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
	powerMonitor,
	screen,
	session,
	shell,
	systemPreferences,
	Tray,
	type Display,
	type IpcMainInvokeEvent,
	type NativeImage,
} from "electron";
import { ScreenCapturer, type CaptureFrame } from "./capture";
import { CaptureAgent } from "./captureAgent";
import { toDevicePixelRect } from "./cropRect";
import { devPermissionHost, readDevOptions } from "./devOptions";
import { diagnosticsDir, initDiagnostics, serializeError, writeDiagnostic } from "./diagnostics";
import type {
	ActionResult,
	AppSettings,
	CaptureAction,
	CaptureFinishPayload,
	CaptureMode,
	CaptureSessionInfo,
	CaptureWindowsInfo,
	DetectedWindow,
	DevPermissionInfo,
	Locale,
	OcrResult,
	PinImageInfo,
	Point,
	Rect,
	SaveResult,
	ScreenPermission,
	ScreenshotItem,
	SensitiveResult,
	SettingsState,
} from "./ipcTypes";
import { mt, setMainLocale } from "./i18n";
import { launchCommandFromArgs, type LaunchCommand } from "./launchArgs";
import { listScreenshots, resolveInDir, saveToLibrary, validateFileName, watchDir } from "./library";
import { isLanguageSetting, resolveLocale } from "./locale";
import { listMacWindows } from "./macWindowList";
import { nativeHelperPath } from "./nativeHelpers";
import { recognizeText } from "./ocr";
import { OnboardingController } from "./onboarding";
import { ONBOARDING_VERSION, relaunchStepFromArgs } from "./onboardingRules";
import { PinManager } from "./pins";
import { defaultScreenshotName, ensurePngExtension } from "./screenshotFiles";
import { supportsScrollCapture } from "./scrollCapture";
import { ScrollCaptureController } from "./scrollSession";
import { findSensitiveRegions, type Identity } from "./sensitiveText";
import { isSelectionMode, loadSettings, saveSettings } from "./settings";
import { WindowListHelper } from "./windowList";
import { toDisplayLocalPoint, toDisplayLocalWindows, type RawWindow } from "./windowRects";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, "public") : RENDERER_DIST;

const APP_ID = "com.newpath.screenshot";

// 开发模式下的环境变量（见 devOptions.ts）；必须在申请单实例锁之前改好用户数据目录
const devOptions = readDevOptions(process.env, app.isPackaged, app.getPath("appData"));
if (devOptions.userDataDir) app.setPath("userData", devOptions.userDataDir);
if (devOptions.remoteDebuggingPort) app.commandLine.appendSwitch("remote-debugging-port", devOptions.remoteDebuggingPort);
/** 开发模式下屏幕录制权限的归属（从终端启动时记在终端上），打包后为 null。 */
const devHost = app.isPackaged || process.platform !== "darwin" ? null : devPermissionHost(process.env);

/** Windows 开机自启时带上这个参数，启动后只驻留托盘、不弹主界面。 */
const HIDDEN_ARG = "--hidden";
/** 开发模式下注册的会是裸的 electron.exe；Linux 上 Electron 不支持登录项。 */
const OPEN_AT_LOGIN_SUPPORTED = app.isPackaged && process.platform !== "linux";
/** macOS 上 Option+字母会打出特殊字符，按 Mac 的习惯用 ⌘ 组合。 */
const DEFAULT_CAPTURE_SHORTCUT = process.platform === "darwin" ? "Command+Shift+X" : "Alt+C";
/** 系统设置里“菜单栏”那一页（macOS 26 起可以在这里隐藏菜单栏图标）。 */
const MENU_BAR_SETTINGS_URL = "x-apple.systempreferences:com.apple.ControlCenter-Settings.extension";
/** 状态栏图标是否显示记在这些用户默认值里；被系统隐藏后，新建图标时先把它们打开。 */
const MENU_BAR_VISIBILITY_KEYS = ["NSStatusItem VisibleCC Item-0", "NSStatusItem Visible Item-0"];
/** macOS 红绿灯按钮的位置，和渲染进程标题栏里留出的空位对齐（MainWindow 的 header、编辑器的 Toolbar）。 */
const MAIN_TRAFFIC_LIGHTS = { x: 20, y: 38 };
const PREVIEW_TRAFFIC_LIGHTS = { x: 18, y: 21 };

type WindowType =
	| "main"
	| "screenshot-region"
	| "screenshot-preview"
	| "screenshot-pin"
	| "onboarding"
	| "permission-helper"
	| "scroll-capture";

/** 选区窗口在截图前一直是透明的，渲染进程画好之后才显示；超过这个时间仍未就绪则强制显示。 */
const REVEAL_TIMEOUT_MS = 1500;
/** 从主界面发起截图时，等主窗口真正从屏幕上消失再截图（Windows 的隐藏动画约 100–200ms）。 */
const HIDE_BEFORE_CAPTURE_MS = 250;
/** 没有屏幕录制权限时连按快捷键，这么久之内只打开一次引导。 */
const PERMISSION_PROMPT_INTERVAL_MS = 15_000;
/** 每隔这么久检查一次全局快捷键是否还在（睡眠唤醒、切换输入法后偶尔会失效）。 */
const SHORTCUT_HEALTH_INTERVAL_MS = 60_000;
/** 切换输入法的系统通知；收到后稍等再读输入法，确认真的变了再重新注册快捷键。 */
const INPUT_SOURCE_NOTIFICATION = "com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged";
const INPUT_SOURCE_CHECK_DELAY_MS = 400;

interface CaptureSession {
	id: number;
	/** 冻结的画面：选区窗口显示它的预览 JPEG，裁剪时从原图取。 */
	frame: CaptureFrame;
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
	/** 一开始就处在滚动截图模式（托盘、命令行的“滚动截图”）。 */
	scrollMode: boolean;
}

const CAPTURE_ACTIONS: readonly CaptureAction[] = ["copy", "copy-path", "save", "edit", "pin", "stitch", "scroll"];

/**
 * macOS 上常驻的截图进程（ScreenCaptureKit）：截屏、窗口列表、单窗口截图、滚动截图都先走它，
 * 不可用时退回一次性的 screencapture / 小工具。开发夹具模式下不需要截屏，只有滚动夹具时才启动它。
 */
function createCaptureAgent(): CaptureAgent | null {
	if (process.platform !== "darwin") return null;
	const executable = nativeHelperPath("newpath-capture-agent");
	return executable ? new CaptureAgent(executable, writeDiagnostic) : null;
}
const captureAgent = devOptions.captureFile ? null : createCaptureAgent();
const scrollAgent = captureAgent ?? (devOptions.scrollFixture ? createCaptureAgent() : null);
const capturer = new ScreenCapturer({ agent: captureAgent, fixtureFile: devOptions.captureFile });

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

const onboarding = new OnboardingController({
	createWindow: (windowType, options) =>
		createWindow(windowType, windowType === "onboarding" ? { ...options, title: mt().onboardingWindowTitle } : options),
	titleBarOptions,
	permission: screenPermissionStatus,
	basics: () => ({
		captureShortcut: settings.captureShortcut,
		shortcutRegistered,
		openAtLogin: OPEN_AT_LOGIN_SUPPORTED && app.getLoginItemSettings(loginItemOptions()).openAtLogin,
		openAtLoginSupported: OPEN_AT_LOGIN_SUPPORTED,
	}),
	dev: devPermissionInfo,
	// 从终端启动的开发版，权限记在终端上，把 Electron.app 拖进列表没有用
	helperAllowed: app.isPackaged || devHost === null,
	agent: captureAgent,
	settingsBundle: devOptions.settingsBundle,
	activateApp,
	markSeen: () => void markOnboardingSeen(),
	onFinish: (capture) => {
		const showMain = mainDeferredForOnboarding;
		mainDeferredForOnboarding = false;
		if (capture) setTimeout(() => void startCapture(), 350);
		else if (showMain) showMainWindow();
	},
	isQuitting: () => isQuitting,
});

const scroll = scrollAgent
	? new ScrollCaptureController({
			agent: scrollAgent,
			createPanel: (options) => createWindow("scroll-capture", { ...options, title: mt().scrollPanelTitle }),
			visibleWindows: () => [...pins.windows, ...(previewWindow ? [previewWindow] : [])],
			onDone: (image) => finishScrollSession(image),
			fixture: devOptions.scrollFixture,
			shortcutsEnabled: devOptions.shortcutEnabled,
		})
	: null;

/** 开发模式下给引导看的权限说明。 */
function devPermissionInfo(): DevPermissionInfo | null {
	if (app.isPackaged) return null;
	const host = devHost ? (devHost.bundleId === "com.apple.Terminal" ? mt().terminalAppName : devHost.name) : null;
	return { host, fixture: capturer.usesFixture };
}

async function markOnboardingSeen() {
	if (settings.onboardingVersion >= ONBOARDING_VERSION) return;
	settings = { ...settings, onboardingVersion: ONBOARDING_VERSION };
	await persistSettings();
}

/** 托盘、设置、命令行里打开引导；macOS 上没有权限时直接停在授权那一步。 */
function openOnboardingFromUser(reason: string) {
	onboarding.open(process.platform === "darwin" && !hasScreenPermission() ? "permission" : "welcome", reason);
}

let settingsFile = "";
let settings: AppSettings;
let locale: Locale = "zh-CN";
let shortcutRegistered = false;
/** 设置里正在录制快捷键时暂停全局快捷键，否则按下当前快捷键会直接开始截图。 */
let shortcutSuspended = false;
let stopWatching: (() => void) | null = null;
/** 当前注册着的全局截图快捷键；只注销它自己，不影响滚动截图临时注册的 Esc / ↩。 */
let registeredShortcut: string | null = null;
/** 上次因为没有权限而打开引导的时间。 */
let lastPermissionPromptAt = 0;
/** 首次启动先显示引导，主界面等引导结束再打开。 */
let mainDeferredForOnboarding = false;
let lastInputSource: string | null = null;
let inputSourceTimer: NodeJS.Timeout | null = null;
let inputSourceSubscription: number | null = null;

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

/**
 * 主窗口和编辑窗口的标题栏：Windows / Linux 上无边框，按钮由渲染进程自绘；
 * macOS 上保留系统的红绿灯按钮（hiddenInset），渲染进程不再画自己的按钮。
 */
function titleBarOptions(trafficLights: Point): Electron.BrowserWindowConstructorOptions {
	if (process.platform === "darwin") return { titleBarStyle: "hiddenInset", trafficLightPosition: trafficLights };
	return { frame: false };
}

/** macOS 上托盘应用（LSUIElement）的窗口显示出来也不会自动拿到焦点，要先激活应用。 */
function activateApp() {
	if (process.platform === "darwin") app.focus({ steal: true });
}

/** showWhenReady 为 false 时只创建、加载好，不显示（开机自启时用）。 */
function getMainWindow(showWhenReady = true) {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

	const win = createWindow("main", {
		width: 1100,
		height: 720,
		minWidth: 880,
		minHeight: 520,
		// 标题栏由渲染进程自绘；不用 transparent，Windows 11 会自动加圆角
		...titleBarOptions(MAIN_TRAFFIC_LIGHTS),
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
	activateApp();
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
		// 盖住 macOS 的菜单栏；macOS 上无边框窗口默认带圆角，盖在截图上会露出四个角
		enableLargerThanScreen: true,
		...(process.platform === "darwin" ? { roundedCorners: false } : {}),
		backgroundColor: "#000000",
		// 隐藏状态下也要能及时处理新会话
		webPreferences: { backgroundThrottling: false },
	});
	win.setAlwaysOnTop(true, "screen-saver");
	// skipTransformProcessType：否则 macOS 上每次调用都会切换进程类型，Dock 图标会闪一下
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
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
		...titleBarOptions(PREVIEW_TRAFFIC_LIGHTS),
		title: mt().previewWindowTitle,
		backgroundColor: "#F2F2F7",
	});
	win.once("ready-to-show", () => {
		activateApp();
		win.show();
	});
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
	activateApp();
	win.show();
	win.focus();
}

// ---------------------------------------------------------------- 截图流程

async function startCapture(mode: CaptureMode = "capture", stitchTarget: BrowserWindow | null = null, scrollMode = false) {
	if (captureSession) {
		regionWindow?.focus();
		return;
	}
	if (scroll?.active) return;
	// 系统框选进行中再按一次快捷键：结束它
	if (capturer.interactiveRunning) {
		capturer.cancelInteractive();
		return;
	}
	if (captureStarting) return;
	captureStarting = true;
	const startedAt = performance.now();
	const systemSelection = usesSystemSelection(scrollMode);
	writeDiagnostic("capture-started", { mode, scroll: scrollMode, selection: systemSelection ? "system" : "overlay" });
	try {
		// 没有屏幕录制权限时，任何截图接口都会让 macOS 弹出它自己的授权框（或只截到桌面壁纸），先打开引导
		if (!hasScreenPermission()) {
			writeDiagnostic("capture-needs-permission", { permission: screenPermissionStatus() });
			restoreMainWindow();
			promptScreenPermission("capture");
			return;
		}
		if (systemSelection) {
			await captureWithSystemSelection(mode, stitchTarget);
			return;
		}

		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		// 枚举窗口和截屏同时进行，不拖慢选区窗口的显示
		const windowsPromise = listWindows();
		const frame = await capturer.captureDisplay(display);
		if (!frame) {
			restoreMainWindow();
			dialog.showErrorBox(mt().captureFailedTitle, mt().captureFailedRetry);
			return;
		}

		const session: CaptureSession = {
			id: ++captureSeq,
			frame,
			display,
			revealed: false,
			startedAt,
			mode,
			stitchTarget,
			windows: null,
			cursor: toDisplayLocalPoint(cursor, display.bounds),
			scrollMode: scrollMode && scrollAvailable(),
		};
		captureSession = session;
		void windowsPromise.then((windows) => {
			if (captureSession !== session) return;
			session.windows = toDisplayLocalWindows(windows, display.bounds, windowRectToDip);
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
	} catch (error) {
		writeDiagnostic("capture-failed", { error: serializeError(error) });
		restoreMainWindow();
	} finally {
		captureStarting = false;
	}
}

/** macOS 上选了“系统框选”时用 screencapture -i；滚动截图总是用 NewPath 的选区。 */
function usesSystemSelection(scrollMode: boolean) {
	return process.platform === "darwin" && settings.selectionMode === "system" && !scrollMode;
}

/** 系统框选：选完直接打开编辑器，拼接模式下追加到编辑窗口。 */
async function captureWithSystemSelection(mode: CaptureMode, stitchTarget: BrowserWindow | null) {
	const { image, failed } = await capturer.captureInteractive();
	restoreMainWindow();
	if (!image) {
		// screencapture 自己出错多半是没有权限
		if (failed && !hasScreenPermission()) promptScreenPermission("system-selection");
		return;
	}
	if (mode === "stitch") deliverStitch(stitchTarget, image);
	else openPreviewWindow(image);
}

/** 把一张图追加到发起拼接的编辑窗口。 */
function deliverStitch(target: BrowserWindow | null, image: NativeImage) {
	if (!target || target.isDestroyed() || target !== previewWindow) return;
	pendingStitch = image;
	target.webContents.send("preview:stitch-added");
}

/** 截图时屏幕上的窗口，按 Z 序从前往后。Windows 上是物理像素，macOS 上已经是点（DIP）。 */
function listWindows(): Promise<RawWindow[]> {
	// 夹具图片不是真实屏幕，识别出的窗口也对不上
	if (capturer.usesFixture) return Promise.resolve([]);
	return process.platform === "darwin" ? listMacWindows(process.pid, captureAgent) : windowLister.list(process.pid);
}

/** screenToDipRect 只在 Windows / Linux 上有；macOS 的窗口坐标本来就是 DIP。 */
function windowRectToDip(rect: Rect): Rect {
	return process.platform === "darwin" ? rect : screen.screenToDipRect(null, rect);
}

/** 屏幕录制权限只有 macOS 需要，其他平台总是 granted。开发模式下从终端启动时，查到的是终端的权限。 */
function screenPermissionStatus(): ScreenPermission {
	return process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
}

/** 开发夹具代替了屏幕时不需要权限。 */
function hasScreenPermission() {
	return capturer.usesFixture || screenPermissionStatus() === "granted";
}

/** 没有权限时打开引导的授权步骤；连按快捷键时不反复打开。 */
function promptScreenPermission(reason: string) {
	if (process.platform !== "darwin") return;
	const now = Date.now();
	if (now - lastPermissionPromptAt < PERMISSION_PROMPT_INTERVAL_MS && onboarding.window) return;
	lastPermissionPromptAt = now;
	onboarding.open("permission", reason);
}

/** 滚动截图需要截图进程和 macOS 14 起的 ScreenCaptureKit；开发用的滚动夹具不受系统版本限制。 */
function scrollAvailable() {
	if (!scroll) return false;
	return !!devOptions.scrollFixture || supportsScrollCapture(process.platform, process.getSystemVersion());
}

/** 主界面的"开始截图"：先把主窗口藏起来，免得它出现在截图里。 */
/** 正在选区、系统框选或滚动截图。 */
function captureBusy() {
	return !!captureSession || captureStarting || capturer.interactiveRunning || !!scroll?.active;
}

async function startCaptureFromMain() {
	if (captureBusy()) return;
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
	if (!target || target.isDestroyed() || captureBusy()) return;
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
	activateApp();
	win.focus();
}

/**
 * 结束选区。keepFrame：调用方还要从画面裁剪，用完自己 release；
 * keepHidden：接着进入滚动截图，主界面和拼接的编辑窗口等滚动截图结束再恢复。
 */
function closeCaptureSession(options: { keepFrame?: boolean; keepHidden?: boolean } = {}) {
	const session = captureSession;
	captureSession = null;
	if (session && !options.keepFrame) session.frame.release();
	const win = regionWindow;
	if (win && !win.isDestroyed()) {
		// 先透明再隐藏：立即消失，下次显示时也不会露出旧画面
		win.setOpacity(0);
		win.hide();
		win.webContents.send("capture:changed");
	}
	if (options.keepHidden) return;
	restoreMainWindow();
	if (session?.stitchTarget) showWindow(session.stitchTarget);
}

/** 滚动截图结束后要恢复的东西：普通截图打开编辑器，拼接模式追加到发起的编辑窗口。 */
let scrollContext: { mode: CaptureMode; stitchTarget: BrowserWindow | null } | null = null;

/** 选区里点了“滚动截图”：换算成原图像素交给截图进程，成功后关掉选区、让出前台。 */
async function startScrollFromSession(session: CaptureSession, rect: Rect) {
	if (!scroll || !scrollAvailable()) return;
	const pixelRect = toDevicePixelRect(rect, session.display.scaleFactor, session.frame.size);
	const started = pixelRect
		? await scroll.start({ display: session.display, pixelRect, frameSize: session.frame.size })
		: false;
	if (captureSession !== session) {
		if (started) scroll.cancel("session-replaced");
		return;
	}
	if (!started) {
		closeCaptureSession();
		dialog.showErrorBox(mt().scrollCaptureFailedTitle, mt().scrollCaptureFailedDetail);
		return;
	}
	scrollContext = { mode: session.mode, stitchTarget: session.stitchTarget };
	closeCaptureSession({ keepHidden: true });
}

function finishScrollSession(image: NativeImage | null) {
	const context = scrollContext;
	scrollContext = null;
	if (image) {
		if (context?.mode === "stitch") deliverStitch(context.stitchTarget, image);
		else openPreviewWindow(image);
	}
	restoreMainWindow();
	if (context?.stitchTarget) showWindow(context.stitchTarget);
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
		screenPermission: screenPermissionStatus(),
	};
}

/** 这次是不是开机自启拉起来的。 */
function launchedAtLogin() {
	if (process.argv.includes(HIDDEN_ARG)) return true;
	if (process.platform !== "darwin") return false;
	const login = app.getLoginItemSettings();
	// macOS 13 起登录项由 SMAppService 管理，wasOpenedAtLogin 总是 false；退而求其次：开了自启、且系统刚启动不久
	return login.wasOpenedAtLogin || (login.openAtLogin && os.uptime() < 120);
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
		return globalShortcut.register(accelerator, () => {
			writeDiagnostic("shortcut-triggered");
			void startCapture();
		});
	} catch {
		// 格式不合法的加速键会直接抛错
		return false;
	}
}

function unregisterCaptureShortcut() {
	if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
	registeredShortcut = null;
}

/** 按当前设置（重新）注册全局快捷键。开发模式下设了 NEWPATH_DEV_SHORTCUT=0 时不注册，免得和安装版抢。 */
function syncShortcut(reason = "sync") {
	unregisterCaptureShortcut();
	if (!shortcutSuspended && devOptions.shortcutEnabled) {
		shortcutRegistered = tryRegister(settings.captureShortcut);
		if (shortcutRegistered) registeredShortcut = settings.captureShortcut;
		writeDiagnostic("shortcut-registered", { reason, ok: shortcutRegistered });
		if (!shortcutRegistered) console.warn(`全局快捷键 ${settings.captureShortcut} 注册失败，可能已被其他程序占用`);
	} else if (!devOptions.shortcutEnabled) {
		shortcutRegistered = false;
	}
	refreshTrayMenu();
}

/** 快捷键偶尔会悄悄失效（睡眠唤醒、切换输入法之后），发现不在了就重新注册；force 时无论如何重来一次。 */
function repairShortcut(reason: string, force = false) {
	if (shortcutSuspended || !devOptions.shortcutEnabled || isQuitting) return;
	if (!force && registeredShortcut && globalShortcut.isRegistered(registeredShortcut)) return;
	writeDiagnostic("shortcut-repair", { reason, force });
	syncShortcut(reason);
}

/** macOS 切换输入法后全局快捷键可能失效：确认输入法真的变了再重新注册。 */
function readInputSource(): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			"/usr/bin/defaults",
			["read", "com.apple.HIToolbox", "AppleSelectedInputSources"],
			{ encoding: "utf8", timeout: 1500 },
			(error, stdout) => resolve(error ? null : stdout.trim() || null),
		);
	});
}

function scheduleInputSourceCheck() {
	if (inputSourceTimer) clearTimeout(inputSourceTimer);
	inputSourceTimer = setTimeout(() => {
		inputSourceTimer = null;
		void readInputSource().then((signature) => {
			if (!signature || signature === lastInputSource) return;
			const changed = lastInputSource !== null;
			lastInputSource = signature;
			if (changed) repairShortcut("input-source", true);
		});
	}, INPUT_SOURCE_CHECK_DELAY_MS);
}

async function changeShortcut(accelerator: string): Promise<ActionResult> {
	// 先试着注册一次，确认可用后再写入设置；失败时恢复原来的快捷键
	unregisterCaptureShortcut();
	const available = tryRegister(accelerator);
	if (available) globalShortcut.unregister(accelerator);
	if (!available) {
		syncShortcut("change-failed");
		return { ok: false, reason: mt().shortcutUnavailable(accelerator) };
	}
	settings = { ...settings, captureShortcut: accelerator };
	syncShortcut("changed");
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
	const { rect, action, windowId } = payload as Record<string, unknown>;
	if (!CAPTURE_ACTIONS.includes(action as CaptureAction) || !rect || typeof rect !== "object") return null;
	const { x, y, width, height } = rect as Record<string, unknown>;
	if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
	const result: CaptureFinishPayload = {
		rect: { x, y, width, height } as CaptureFinishPayload["rect"],
		action: action as CaptureAction,
	};
	if (typeof windowId === "number" && Number.isInteger(windowId) && windowId > 0) result.windowId = windowId;
	return result;
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
			imageBytes: session.frame.previewJpeg,
			mimeType: "image/jpeg",
			scaleFactor: session.display.scaleFactor,
			mode: session.mode,
			cursor: session.cursor,
			scrollAvailable: scrollAvailable(),
			scrollMode: session.scrollMode,
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
		writeDiagnostic("capture-finished", { action: payload.action, window: payload.windowId !== undefined });
		if (payload.action === "scroll") {
			await startScrollFromSession(session, payload.rect);
			return;
		}
		// 拼接模式只接受 stitch，普通截图不接受 stitch
		if ((payload.action === "stitch") !== (session.mode === "stitch")) return;
		const { scaleFactor, bounds } = session.display;
		const crop = toDevicePixelRect(payload.rect, scaleFactor, session.frame.size);
		// 只认这次截图里识别出的窗口
		const windowId =
			payload.windowId !== undefined && session.windows?.some((item) => item.id === payload.windowId)
				? payload.windowId
				: null;
		closeCaptureSession({ keepFrame: true });
		if (!crop) {
			session.frame.release();
			return;
		}

		let image: NativeImage | null = null;
		try {
			// 单击选中的窗口：单独截取这个窗口（被挡住的部分也完整、带透明圆角），失败时退回按选区裁剪
			if (windowId !== null) image = await capturer.captureWindow(windowId);
			image ??= await session.frame.crop(crop);
		} finally {
			session.frame.release();
		}
		if (!image) {
			dialog.showErrorBox(mt().captureFailedTitle, mt().captureFailedRetry);
			return;
		}
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
			case "stitch":
				deliverStitch(session.stitchTarget, image);
				break;
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

	// 欢迎引导
	ipcMain.handle("onboarding:get-state", (event) => (onboarding.isFrom(event) ? onboarding.state() : null));

	ipcMain.handle("onboarding:request-permission", async (event): Promise<ScreenPermission> => {
		if (!onboarding.isFrom(event)) return screenPermissionStatus();
		return onboarding.requestPermission();
	});

	ipcMain.handle("onboarding:relaunch", (event) => {
		// 稍等一下，让渲染进程先收到回应
		if (onboarding.isFrom(event)) setTimeout(() => onboarding.relaunch(), 50);
	});

	ipcMain.handle("onboarding:finish", (event, capture: unknown) => {
		if (onboarding.isFrom(event)) onboarding.finish(capture === true);
	});

	// 拖拽授权小窗（startDrag 要用 send，不能用 invoke）
	ipcMain.on("permission-helper:drag", (event) => onboarding.startDrag(event));

	// 滚动截图的进度面板
	ipcMain.handle("scroll:get-state", (event) => (scroll?.isFromPanel(event) ? scroll.state() : null));

	ipcMain.handle("scroll:get-preview", (event) => (scroll?.isFromPanel(event) ? scroll.previewBytes() : null));

	ipcMain.handle("scroll:finish", (event) => {
		if (scroll?.isFromPanel(event)) void scroll.finish("panel");
	});

	ipcMain.handle("scroll:cancel", (event) => {
		if (scroll?.isFromPanel(event)) scroll.cancel("panel");
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

	// 主窗口和欢迎引导都能改开机自启
	ipcMain.handle("settings:set-open-at-login", (event, enabled: unknown): ActionResult => {
		if (!isFrom(event, mainWindow) && !onboarding.isFrom(event)) throw new Error("settings:set-open-at-login 调用来源无效");
		if (typeof enabled !== "boolean") return { ok: false, reason: mt().invalidArgument };
		const result = setOpenAtLogin(enabled);
		onboarding.notifyChanged();
		return result;
	});

	handleMain("settings:set-selection-mode", async (mode): Promise<SettingsState> => {
		if (isSelectionMode(mode) && mode !== settings.selectionMode && process.platform === "darwin") {
			settings = { ...settings, selectionMode: mode };
			writeDiagnostic("selection-mode-changed", { mode });
			await persistSettings();
		}
		return getSettingsState();
	});

	handleMain("settings:open-onboarding", () => openOnboardingFromUser("settings"));

	handleMain("settings:open-logs", async () => {
		const dir = diagnosticsDir() ?? path.join(app.getPath("userData"), "logs");
		await fs.mkdir(dir, { recursive: true });
		await shell.openPath(dir);
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
	allowMenuBarItem();
	let icon: NativeImage;
	if (process.platform === "darwin") {
		// 菜单栏用单色模板图（同目录的 @2x 会自动加载），系统按浅色 / 深色菜单栏自动着色
		icon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, "trayTemplate.png"));
		icon.setTemplateImage(true);
	} else {
		icon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, "icon.png")).resize({ width: 16, height: 16 });
	}
	tray = new Tray(icon);
	tray.setToolTip(mt().trayTooltip);
	// macOS 的惯例是单击菜单栏图标弹出菜单；Windows / Linux 上单击直接截图
	if (process.platform !== "darwin") tray.on("click", () => void startCapture());
	refreshTrayMenu();
}

/**
 * macOS 会把放不下的菜单栏图标藏起来，macOS 26 起用户也能在“系统设置 → 菜单栏”里关掉某个应用的图标。
 * 菜单栏是 NewPath 唯一常驻的入口，所以新建图标前先请求显示；新建时系统会读这些键。
 */
function allowMenuBarItem() {
	if (process.platform !== "darwin") return;
	for (const key of MENU_BAR_VISIBILITY_KEYS) {
		if (systemPreferences.getUserDefault(key, "boolean") !== true) systemPreferences.setUserDefault(key, "boolean", true);
	}
}

/**
 * 被隐藏的菜单栏图标高度为 0。先重建一次（重建时会请求显示）；还是看不见，且用户是主动打开应用（explain）时，
 * 告诉用户应用在运行、怎么截图、去哪里把图标打开。
 */
function checkTrayVisible(reason: string, explain: boolean, retried = false) {
	if (process.platform !== "darwin" || !tray || tray.isDestroyed()) return;
	const bounds = tray.getBounds();
	if (bounds.height > 0) return;
	writeDiagnostic("tray-hidden", { reason, retried });
	if (!retried) {
		tray.destroy();
		tray = null;
		createTray();
		setTimeout(() => checkTrayVisible(reason, explain, true), 800);
		return;
	}
	if (explain) void explainHiddenMenuBarIcon();
}

async function explainHiddenMenuBarIcon() {
	const m = mt();
	activateApp();
	const { response } = await dialog.showMessageBox({
		type: "info",
		message: m.menuBarHiddenTitle,
		detail: m.menuBarHiddenDetail(formatShortcutForDialog(settings.captureShortcut)),
		buttons: [m.menuBarHiddenOpenSettings, m.menuBarHiddenOk],
		defaultId: 0,
		cancelId: 1,
	});
	if (response === 0) void shell.openExternal(MENU_BAR_SETTINGS_URL);
}

/** 对话框里的快捷键写法：macOS 上用 ⌘⇧ 这样的符号。 */
function formatShortcutForDialog(accelerator: string) {
	if (process.platform !== "darwin") return accelerator;
	const symbols: Record<string, string> = {
		Command: "⌘",
		Cmd: "⌘",
		CommandOrControl: "⌘",
		CmdOrCtrl: "⌘",
		Control: "⌃",
		Ctrl: "⌃",
		Alt: "⌥",
		Option: "⌥",
		Shift: "⇧",
	};
	return accelerator
		.split("+")
		.map((part) => symbols[part] ?? part)
		.join("");
}

/**
 * macOS 上输入框里的 ⌘C / ⌘V / ⌘A、⌘W 关窗口、⌘Q 退出都靠应用菜单。默认菜单里还有“重新加载”和
 * 页面缩放（⌘0 / ⌘= / ⌘-，会抢走编辑器的缩放快捷键），所以换成精简的菜单；开发时保留开发者工具。
 */
function setMacAppMenu() {
	const template: Electron.MenuItemConstructorOptions[] = [
		{ role: "appMenu" },
		{ role: "fileMenu" },
		{ role: "editMenu" },
		{ role: "windowMenu" },
	];
	if (VITE_DEV_SERVER_URL) template.push({ label: "Developer", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] });
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
			...(scrollAvailable()
				? [{ label: m.trayScrollCapture, click: () => void startCapture("capture", null, true) }]
				: []),
			{ label: m.trayCloseAllPins, enabled: pins.count > 0, click: () => pins.closeAll() },
			{ type: "separator" },
			{ label: m.trayOnboarding, click: () => openOnboardingFromUser("tray") },
			{ type: "separator" },
			{ label: m.trayQuit, role: "quit" },
		]),
	);
}

// ---------------------------------------------------------------- 启动

function handleLaunchCommand(command: LaunchCommand) {
	writeDiagnostic("launch-command", { command });
	switch (command) {
		case "capture":
			void startCapture();
			break;
		case "capture-scroll":
			void startCapture("capture", null, scrollAvailable());
			break;
		case "onboarding":
			openOnboardingFromUser("command-line");
			break;
		case "show":
			showMainWindow();
			break;
	}
}

/** 睡眠、锁屏时结束进行中的截图；醒来后快捷键可能失效，截图进程也要重新准备。 */
function watchPower() {
	const stopCapturing = (reason: string) => {
		writeDiagnostic("power-inactive", { reason });
		capturer.cancelInteractive();
		scroll?.cancel(reason);
		if (captureSession) closeCaptureSession();
	};
	const recover = (reason: string) => {
		writeDiagnostic("power-recovery", { reason });
		repairShortcut(reason, true);
		warmCaptureAgent(reason);
	};
	powerMonitor.on("suspend", () => stopCapturing("suspend"));
	powerMonitor.on("lock-screen", () => stopCapturing("lock-screen"));
	powerMonitor.on("resume", () => recover("resume"));
	powerMonitor.on("unlock-screen", () => recover("unlock-screen"));
}

/** 有权限时让截图进程提前准备好 ScreenCaptureKit，第一次截图和之后一样快。 */
function warmCaptureAgent(reason: string) {
	if (!captureAgent || screenPermissionStatus() !== "granted") return;
	void captureAgent.request({ cmd: "warm" }, 5000).then((response) => {
		writeDiagnostic("capture-agent-warm", { reason, ok: response?.ok ?? false, ms: response?.ms, error: response?.error });
	});
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	// 再次启动应用时打开主界面（带命令行参数时执行对应命令）；macOS 上在访达里再次打开已在运行的应用，触发的是 activate
	app.on("second-instance", (_event, argv) => {
		if (!app.isReady()) return;
		const command = launchCommandFromArgs(argv);
		if (command) {
			handleLaunchCommand(command);
			return;
		}
		showMainWindow();
		checkTrayVisible("second-instance", true);
	});
	app.on("activate", () => {
		if (!app.isReady()) return;
		showMainWindow();
		checkTrayVisible("activate", true);
	});

	// 托盘应用：关闭所有窗口后继续驻留
	app.on("window-all-closed", () => {});

	app.on("before-quit", () => {
		isQuitting = true;
	});

	app.on("will-quit", () => {
		globalShortcut.unregisterAll();
		stopWatching?.();
		windowLister.dispose();
		capturer.cancelInteractive();
		scroll?.cancel("quit");
		captureAgent?.stop();
		if (scrollAgent !== captureAgent) scrollAgent?.stop();
		if (inputSourceSubscription !== null) systemPreferences.unsubscribeNotification(inputSourceSubscription);
	});

	app.whenReady().then(async () => {
		await initDiagnostics(path.join(app.getPath("userData"), "logs"), { echo: !!VITE_DEV_SERVER_URL });
		writeDiagnostic("app-ready", {
			version: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			os: process.getSystemVersion(),
			packaged: app.isPackaged,
			permission: screenPermissionStatus(),
			agent: !!captureAgent,
			fixture: capturer.usesFixture,
			devHost: devHost?.bundleId ?? devHost?.name ?? null,
		});
		if (process.platform === "darwin") {
			app.dock?.hide();
			setMacAppMenu();
		}
		if (process.platform === "win32") app.setAppUserModelId(APP_ID);
		// 渲染进程不需要摄像头、麦克风、通知等任何浏览器权限，一律拒绝
		session.defaultSession.setPermissionCheckHandler(() => false);
		session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

		settingsFile = path.join(app.getPath("userData"), "settings.json");
		settings = await loadSettings(settingsFile, {
			captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
			saveDir: path.join(app.getPath("pictures"), "NewPath"),
			language: "system",
			selectionMode: "overlay",
			onboardingVersion: 0,
		});
		// 这时还没有窗口和托盘，只算出语言
		applyLocale();

		registerIpc();
		createTray();
		syncShortcut("app-ready");
		startWatching();
		// Windows 的窗口枚举进程启动要一两秒，提前拉起来；macOS 上用常驻的截图进程，下面预热
		windowLister.start();
		warmCaptureAgent("app-ready");
		// 提前创建并加载好选区窗口，第一次截图也不用等页面加载
		getRegionWindow();

		// 授权后重启 / 系统设置“退出并重新打开” / 第一次启动：先打开引导，主界面等引导结束再显示
		const command = launchCommandFromArgs(process.argv);
		const relaunchStep = relaunchStepFromArgs(process.argv);
		const atLogin = launchedAtLogin();
		let guideOpened = false;
		if (relaunchStep) {
			onboarding.clearPendingMarker();
			onboarding.open(relaunchStep, "relaunch");
			guideOpened = true;
		} else if (process.platform === "darwin" && onboarding.celebrateIfPending()) {
			guideOpened = true;
		} else if (settings.onboardingVersion < ONBOARDING_VERSION && !atLogin && !command) {
			onboarding.open("welcome", "first-launch");
			guideOpened = true;
		}
		mainDeferredForOnboarding = guideOpened && !atLogin;
		// 开机自启时只驻留托盘；主窗口照样提前加载，之后打开不用等
		getMainWindow(!atLogin && !guideOpened && !command);
		if (command) handleLaunchCommand(command);
		// 菜单栏图标被系统藏起来时先悄悄重建一次
		setTimeout(() => checkTrayVisible("launch", false), 1500);

		watchPower();
		setInterval(() => repairShortcut("health"), SHORTCUT_HEALTH_INTERVAL_MS);
		if (process.platform === "darwin") {
			lastInputSource = await readInputSource();
			inputSourceSubscription = systemPreferences.subscribeNotification(INPUT_SOURCE_NOTIFICATION, () =>
				scheduleInputSourceCheck(),
			);
		}
	});
}
