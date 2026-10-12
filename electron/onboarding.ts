import { rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	app,
	BrowserWindow,
	nativeImage,
	screen,
	shell,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
} from "electron";
import type { CaptureAgent } from "./captureAgent";
import { writeDiagnostic } from "./diagnostics";
import type { DevPermissionInfo, OnboardingState, OnboardingStep, ScreenPermission } from "./ipcTypes";
import {
	HELPER_SIZE,
	ONBOARDING_RELAUNCH_ARG,
	ONBOARDING_SIZE,
	ONBOARDING_TRAFFIC_LIGHTS,
	placePermissionHelper,
	SCREEN_RECORDING_SETTINGS_URL,
} from "./onboardingRules";

// 欢迎引导和屏幕录制授权。思路参考 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）：
// 没有权限时不调用任何截图接口（否则系统会弹出自己的授权框压在最上面），改为打开引导；
// 引导里“去授权”先让系统登记应用并打开“屏幕录制”设置页，同时在系统设置窗口下方放一个可以拖动应用图标的小窗，
// 拖进列表就完成授权。系统设置的“退出并重新打开”会直接重启应用，所以用一个标记文件记住“刚才在授权”。

const SYSTEM_SETTINGS_BUNDLE = "com.apple.systempreferences";
const PERMISSION_PENDING_MARKER = "permission-pending";
const HELPER_POLL_MS = 300;
/** 系统设置关掉这么久之后，拖拽小窗也收起来。 */
const HELPER_IDLE_CLOSE_MS = 20_000;
/** 引导打开期间多久检查一次权限，授权后界面立刻更新。 */
const PERMISSION_POLL_MS = 1000;

export interface OnboardingDeps {
	createWindow: (
		windowType: "onboarding" | "permission-helper",
		options: Electron.BrowserWindowConstructorOptions,
	) => BrowserWindow;
	/** 和标题栏有关的窗口选项（macOS 红绿灯 / 其他平台无边框）。 */
	titleBarOptions: (trafficLights: { x: number; y: number }) => Electron.BrowserWindowConstructorOptions;
	permission: () => ScreenPermission;
	/** 快捷键和开机自启的当前状态。 */
	basics: () => Pick<OnboardingState, "captureShortcut" | "shortcutRegistered" | "openAtLogin" | "openAtLoginSupported">;
	/** 开发模式下的权限说明，打包后返回 null；文案随语言变化，所以每次现取。 */
	dev: () => DevPermissionInfo | null;
	/** 能不能显示拖拽小窗：开发模式下从终端启动时权限记在终端上，拖 Electron.app 进去没用。 */
	helperAllowed: boolean;
	agent: CaptureAgent | null;
	/** 测试拖拽小窗时代替“系统设置”的应用。 */
	settingsBundle: string | null;
	activateApp: () => void;
	/** 引导关闭时记下“已看过”。 */
	markSeen: () => void;
	/** 引导结束后：capture 为 true 时截一张试试，否则打开主界面（首次启动时主界面先不显示）。 */
	onFinish: (capture: boolean) => void;
	isQuitting: () => boolean;
}

export class OnboardingController {
	private win: BrowserWindow | null = null;
	private step: OnboardingStep = "welcome";
	private helper: BrowserWindow | null = null;
	private helperTimer: NodeJS.Timeout | null = null;
	private permissionTimer: NodeJS.Timeout | null = null;
	private lastPermission: ScreenPermission | null = null;
	/** 拖拽小窗显示期间引导先让开，避免拖动时挡住系统设置。 */
	private hiddenForHelper = false;
	private finishing = false;

	constructor(private readonly deps: OnboardingDeps) {}

	get window() {
		return this.win && !this.win.isDestroyed() ? this.win : null;
	}

	get helperWindow() {
		return this.helper && !this.helper.isDestroyed() ? this.helper : null;
	}

	isFrom(event: IpcMainInvokeEvent | IpcMainEvent) {
		const win = this.window;
		return !!win && event.sender === win.webContents;
	}

	isFromHelper(event: IpcMainInvokeEvent | IpcMainEvent) {
		const helper = this.helperWindow;
		return !!helper && event.sender === helper.webContents;
	}

	state(): OnboardingState {
		return { step: this.step, permission: this.deps.permission(), dev: this.deps.dev(), ...this.deps.basics() };
	}

	/** 打开引导并停在指定步骤；已经开着就切过去。 */
	open(step: OnboardingStep, reason: string) {
		writeDiagnostic("onboarding-opened", { step, reason });
		// 不在 macOS 上没有授权这一步
		this.step = step === "permission" && process.platform !== "darwin" ? "welcome" : step;
		const existing = this.window;
		if (existing) {
			this.notifyChanged();
			this.hiddenForHelper = false;
			this.deps.activateApp();
			existing.show();
			existing.focus();
			return;
		}
		const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
		const win = this.deps.createWindow("onboarding", {
			...ONBOARDING_SIZE,
			x: Math.round(workArea.x + (workArea.width - ONBOARDING_SIZE.width) / 2),
			y: Math.round(workArea.y + (workArea.height - ONBOARDING_SIZE.height) / 2),
			resizable: false,
			maximizable: false,
			minimizable: false,
			fullscreenable: false,
			...this.deps.titleBarOptions(ONBOARDING_TRAFFIC_LIGHTS),
			backgroundColor: "#F2F2F7",
		});
		this.win = win;
		this.finishing = false;
		win.once("ready-to-show", () => {
			if (win.isDestroyed()) return;
			this.deps.activateApp();
			win.show();
			win.focus();
		});
		win.on("closed", () => {
			if (this.win !== win) return;
			this.win = null;
			this.stopPermissionPolling();
			this.closeHelper();
			this.deps.markSeen();
			// 直接关掉引导（没点“完成”）也当作结束，首次启动时把主界面打开
			if (!this.finishing && !this.deps.isQuitting()) this.deps.onFinish(false);
		});
		this.startPermissionPolling();
	}

	notifyChanged() {
		const win = this.window;
		if (win) win.webContents.send("onboarding:changed");
	}

	/** 引导开着的时候盯着权限状态，系统设置里一打开开关，界面就跟着变。 */
	private startPermissionPolling() {
		if (process.platform !== "darwin" || this.permissionTimer) return;
		this.lastPermission = this.deps.permission();
		this.permissionTimer = setInterval(() => {
			const current = this.deps.permission();
			if (current === this.lastPermission) return;
			writeDiagnostic("screen-permission-changed", { from: this.lastPermission, to: current });
			this.lastPermission = current;
			if (current === "granted") {
				this.closeHelper();
				if (this.step === "permission") this.step = "done";
			}
			this.notifyChanged();
		}, PERMISSION_POLL_MS);
	}

	private stopPermissionPolling() {
		if (this.permissionTimer) clearInterval(this.permissionTimer);
		this.permissionTimer = null;
	}

	/**
	 * “去授权”：先让截图进程调用 CGRequestScreenCaptureAccess，系统会把应用登记进“屏幕录制”列表
	 * （第一次还会弹出系统自己的授权框）；再打开设置页、显示拖拽小窗，引导暂时让开。
	 */
	async requestPermission(): Promise<ScreenPermission> {
		if (process.platform !== "darwin") return "granted";
		writeDiagnostic("screen-permission-requested", { permission: this.deps.permission() });
		try {
			writeFileSync(path.join(app.getPath("userData"), PERMISSION_PENDING_MARKER), new Date().toISOString());
		} catch {
			// 标记写不进去只是重启后少一句“授权成功”
		}
		const response = await this.deps.agent?.request({ cmd: "request-access" }, 5000);
		writeDiagnostic("screen-permission-request-result", { ok: response?.ok ?? false, granted: response?.granted });
		const permission = this.deps.permission();
		if (permission === "granted") {
			this.step = "done";
			this.notifyChanged();
			return permission;
		}
		if (!this.deps.settingsBundle) void shell.openExternal(SCREEN_RECORDING_SETTINGS_URL);
		if (this.showHelper()) {
			this.hiddenForHelper = true;
			this.window?.hide();
		}
		return permission;
	}

	/** 授权后重启应用，重启后停在“完成”这一步。 */
	relaunch() {
		writeDiagnostic("onboarding-relaunch");
		const args = process.argv.slice(1).filter((arg) => !arg.startsWith(ONBOARDING_RELAUNCH_ARG));
		this.clearPendingMarker();
		app.relaunch({ args: [...args, `${ONBOARDING_RELAUNCH_ARG}done`] });
		app.quit();
	}

	finish(capture: boolean) {
		this.finishing = true;
		this.window?.close();
		this.deps.onFinish(capture);
	}

	/** 系统设置的“退出并重新打开”把应用重启了：已经授权的话，打开引导的最后一步告诉用户成功了。返回是否打开了引导。 */
	celebrateIfPending(): boolean {
		const marker = path.join(app.getPath("userData"), PERMISSION_PENDING_MARKER);
		try {
			statSync(marker);
		} catch {
			return false;
		}
		this.clearPendingMarker();
		if (this.deps.permission() !== "granted") return false;
		this.open("done", "permission-granted");
		return true;
	}

	clearPendingMarker() {
		rmSync(path.join(app.getPath("userData"), PERMISSION_PENDING_MARKER), { force: true });
	}

	/** 系统设置里“屏幕录制”列表显示的是这个 .app。 */
	private appBundlePath() {
		return path.resolve(app.getPath("exe"), "..", "..", "..");
	}

	/** 拖拽小窗开始拖动：拖的是应用本身。 */
	startDrag(event: IpcMainEvent) {
		if (!this.isFromHelper(event)) return;
		const iconPath = path.join(process.env.VITE_PUBLIC ?? "", "icon.png");
		const icon = nativeImage.createFromPath(iconPath).resize({ width: 64, height: 64 });
		writeDiagnostic("permission-helper-drag");
		event.sender.startDrag({ file: this.appBundlePath(), icon });
	}

	/** 跟着系统设置窗口走的拖拽小窗；授权后或系统设置关掉一段时间后自动收起。返回是否显示了。 */
	private showHelper(): boolean {
		const agent = this.deps.agent;
		if (process.platform !== "darwin" || !agent || !this.deps.helperAllowed) return false;
		this.closeHelper();
		const helper = this.deps.createWindow("permission-helper", {
			...HELPER_SIZE,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			focusable: false,
			skipTaskbar: true,
			hasShadow: false,
		});
		this.helper = helper;
		helper.setAlwaysOnTop(true, "floating");
		helper.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
		writeDiagnostic("permission-helper-shown");

		const startedAt = Date.now();
		let lastSeenAt = Date.now();
		let busy = false;
		this.helperTimer = setInterval(() => {
			if (busy || helper.isDestroyed()) return;
			if (this.deps.permission() === "granted") {
				writeDiagnostic("permission-helper-granted", { ms: Date.now() - startedAt });
				this.closeHelper();
				return;
			}
			busy = true;
			void agent
				.request({ cmd: "app-window", bundle: this.deps.settingsBundle ?? SYSTEM_SETTINGS_BUNDLE }, 800)
				.then((frame) => {
					if (helper.isDestroyed()) return;
					if (!frame?.ok) {
						if (helper.isVisible()) helper.hide();
						if (Date.now() - lastSeenAt > HELPER_IDLE_CLOSE_MS) this.closeHelper();
						return;
					}
					lastSeenAt = Date.now();
					const bounds = { x: Number(frame.x), y: Number(frame.y), width: Number(frame.width), height: Number(frame.height) };
					if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return;
					const { workArea } = screen.getDisplayMatching(bounds);
					const { x, y } = placePermissionHelper(bounds, workArea);
					const current = helper.getBounds();
					if (current.x !== x || current.y !== y) helper.setPosition(x, y);
					if (!helper.isVisible() && !helper.webContents.isLoading()) helper.showInactive();
				})
				.finally(() => {
					busy = false;
				});
		}, HELPER_POLL_MS);
		return true;
	}

	closeHelper() {
		if (this.helperTimer) clearInterval(this.helperTimer);
		this.helperTimer = null;
		const helper = this.helper;
		this.helper = null;
		if (helper && !helper.isDestroyed()) helper.destroy();
		if (this.hiddenForHelper) {
			this.hiddenForHelper = false;
			const guide = this.window;
			if (guide && !this.deps.isQuitting()) {
				this.deps.activateApp();
				guide.show();
				guide.focus();
			}
		}
	}
}
