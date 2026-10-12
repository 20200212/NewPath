import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, globalShortcut, nativeImage, screen, type Display, type IpcMainInvokeEvent, type NativeImage } from "electron";
import type { AgentEvent, CaptureAgent } from "./captureAgent";
import { serializeError, writeDiagnostic } from "./diagnostics";
import type { Rect, ScrollCaptureState } from "./ipcTypes";
import {
	parseScrollProgress,
	scrollMaxHeight,
	scrollPanelLayout,
	scrollRegionFromSelection,
	scrollRingLayout,
	type ScrollProgress,
} from "./scrollCapture";

// 滚动截图（macOS 14 起）：选区确定后 NewPath 让出前台，截图进程持续截取选区并拼接，
// 选区四周画一圈彩色边框，旁边的面板显示进度；完成（↩）把长图交出去，Esc 取消。
// 移植自 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）。

const START_TIMEOUT_MS = 5000;
const FINISH_TIMEOUT_MS = 30_000;
/** 忘了结束的滚动截图到时间自动完成，不会一直录下去。 */
const CAPTURE_LIMIT_MS = 10 * 60 * 1000;
/** 出错时在面板上显示这么久再结束。 */
const ERROR_DISPLAY_MS = 2400;
const SHORTCUT_KEYS = ["Escape", "Return"] as const;

interface Session {
	frameHeight: number;
	ring: BrowserWindow | null;
	panel: BrowserWindow | null;
	previewPath: string;
	progress: ScrollProgress;
	/** 最新的预览 JPEG，面板晚到时也能拉到。 */
	preview: Buffer | null;
	finishing: boolean;
	startedAt: number;
	timer: NodeJS.Timeout | null;
}

export interface ScrollStartRequest {
	display: Display;
	/** 选区窗口里的选区，换算成原图像素后的整数矩形。 */
	pixelRect: Rect;
	frameSize: { width: number; height: number };
}

export interface ScrollDeps {
	agent: CaptureAgent;
	createPanel: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
	/** 让出前台时要重新露出来的 NewPath 窗口（钉图、编辑器）。 */
	visibleWindows: () => BrowserWindow[];
	/** 拿到长图；null 表示取消或失败。 */
	onDone: (image: NativeImage | null) => void;
	/** 开发模式下代替屏幕的长图（NEWPATH_DEV_SCROLL_FIXTURE）。 */
	fixture: string | null;
	/** 开发模式关掉了全局快捷键时，也不抢 Esc / ↩，用面板上的按钮。 */
	shortcutsEnabled: boolean;
}

function temporaryPath(prefix: string, extension: string) {
	return path.join(os.tmpdir(), `newpath-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
}

export class ScrollCaptureController {
	private session: Session | null = null;

	constructor(private readonly deps: ScrollDeps) {
		deps.agent.onEvent((event) => this.handleAgentEvent(event));
	}

	get active() {
		return this.session !== null;
	}

	isFromPanel(event: IpcMainInvokeEvent) {
		const panel = this.session?.panel;
		return !!panel && !panel.isDestroyed() && event.sender === panel.webContents;
	}

	state(): ScrollCaptureState | null {
		const session = this.session;
		if (!session) return null;
		const { status, width, height, preview } = session.progress;
		return { status, width, height, previewId: preview, frameHeight: session.frameHeight };
	}

	previewBytes(): Buffer | null {
		return this.session?.preview ?? null;
	}

	/** 开始滚动截图；截图进程不接受（太小、系统不支持、没权限）时返回 false，调用方保持选区不变。 */
	async start(request: ScrollStartRequest): Promise<boolean> {
		if (this.session) return false;
		const { display } = request;
		const region = scrollRegionFromSelection(request.pixelRect, request.frameSize, display.bounds);
		if (!region) return false;
		const previewPath = temporaryPath("scroll-preview", "jpg");
		const startedAt = Date.now();
		const response = await this.deps.agent.request(
			{
				cmd: "scroll-start",
				display: display.id,
				rect: region.points,
				size: region.pixels,
				exclude: process.pid,
				maxHeight: scrollMaxHeight(region.pixels.width),
				preview: previewPath,
				...(this.deps.fixture ? { fixture: this.deps.fixture } : {}),
			},
			START_TIMEOUT_MS,
		);
		if (!response?.ok) {
			writeDiagnostic("scroll-capture-start-failed", { error: response?.error ?? "no response" });
			return false;
		}
		if (this.session) {
			void this.deps.agent.request({ cmd: "scroll-cancel" }, 2000);
			return false;
		}
		const session: Session = {
			frameHeight: region.pixels.height,
			ring: null,
			panel: null,
			previewPath,
			progress: { status: "waiting", height: region.pixels.height, width: region.pixels.width, preview: 0 },
			preview: null,
			finishing: false,
			startedAt,
			timer: null,
		};
		this.session = session;
		this.yieldForeground();
		session.ring = this.createRing(region.global, display);
		session.panel = this.createPanel(region.global, display);
		session.timer = setTimeout(() => void this.finish("time-limit"), CAPTURE_LIMIT_MS);
		if (this.deps.shortcutsEnabled) {
			for (const key of SHORTCUT_KEYS) {
				try {
					globalShortcut.register(key, () => (key === "Escape" ? this.cancel("escape") : void this.finish("return")));
				} catch {
					// 注册不上就只能用面板上的按钮
				}
			}
		}
		writeDiagnostic("scroll-capture-started", { ...region.pixels, ms: Date.now() - startedAt });
		return true;
	}

	/**
	 * 把前台还给正在滚动的应用，让它保持激活、接收键盘。隐藏应用会把所有窗口一起藏起来，
	 * 所以再把原本开着的钉图和编辑器不抢焦点地显示回来。
	 */
	private yieldForeground() {
		if (process.platform !== "darwin") return;
		const showing = this.deps.visibleWindows().filter((win) => !win.isDestroyed() && win.isVisible());
		app.hide();
		for (const win of showing) win.showInactive();
	}

	/** 选区四周慢慢转动的彩色边框；不接收鼠标，也不会被截进长图。 */
	private createRing(area: Rect, display: Display) {
		const layout = scrollRingLayout(area, display.bounds);
		const { ring } = layout;
		const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@property --turn{syntax:'<angle>';inherits:false;initial-value:0deg}
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.shade{position:absolute;left:${ring.x}px;top:${ring.y}px;width:${ring.width}px;height:${ring.height}px;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.35))}
.ring{width:100%;height:100%;box-sizing:border-box;padding:3px;border-radius:9px;
background:conic-gradient(from var(--turn),#FF5A7A,#FF9F43,#FFD43B,#38D9A9,#4DABF7,#9775FA,#FF5A7A);
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
animation:turn 6s linear infinite}
@keyframes turn{to{--turn:360deg}}
@media (prefers-reduced-motion:reduce){.ring{animation:none}}
</style></head><body><div class="shade"><div class="ring"></div></div></body></html>`;
		const win = new BrowserWindow({
			...layout.window,
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
			enableLargerThanScreen: true,
			roundedCorners: false,
			show: false,
			webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
		});
		win.webContents.on("will-navigate", (event) => event.preventDefault());
		win.setIgnoreMouseEvents(true);
		win.setAlwaysOnTop(true, "floating");
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
		void win
			.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
			.then(() => {
				if (!win.isDestroyed() && this.session?.ring === win) win.showInactive();
			})
			.catch(() => {});
		return win;
	}

	/** 进度、预览、完成和取消。面板（panel）类型：点它不会激活 NewPath，被滚动的应用一直在前台。 */
	private createPanel(area: Rect, display: Display) {
		const workAreas = [display, ...screen.getAllDisplays().filter((other) => other.id !== display.id)].map(
			(other) => other.workArea,
		);
		const panel = this.deps.createPanel({
			...scrollPanelLayout(area, workAreas),
			type: "panel",
			// 面板永远不会成为主窗口，每次点击都是“第一次点击”
			acceptFirstMouse: true,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: true,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			focusable: false,
			skipTaskbar: true,
			hasShadow: false,
			webPreferences: { backgroundThrottling: false },
		});
		panel.setAlwaysOnTop(true, "floating", 1);
		panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
		panel.once("ready-to-show", () => {
			if (!panel.isDestroyed() && this.session?.panel === panel) panel.showInactive();
		});
		panel.webContents.on("render-process-gone", () => {
			if (this.session?.panel === panel) this.cancel("panel-gone");
		});
		return panel;
	}

	private notifyPanel(session: Session) {
		const panel = session.panel;
		if (panel && !panel.isDestroyed()) panel.webContents.send("scroll:changed");
	}

	private handleAgentEvent(event: AgentEvent) {
		const session = this.session;
		if (!session) return;
		if (event.event === "stopped") {
			if (!session.finishing) this.fail(session, "agent-stopped");
			return;
		}
		const progress = parseScrollProgress(event);
		if (!progress || session.finishing) return;
		if (progress.status === "error") {
			this.fail(session, "stream-error");
			return;
		}
		const previewChanged = progress.preview !== session.progress.preview;
		session.progress = progress;
		if (!previewChanged) {
			this.notifyPanel(session);
			return;
		}
		void fs
			.readFile(session.previewPath)
			.then((bytes) => {
				// 更新的预览已经在路上了，它也带着这次的进度
				if (this.session !== session || session.progress.preview !== progress.preview) return;
				session.preview = bytes;
				this.notifyPanel(session);
			})
			.catch(() => this.notifyPanel(session));
	}

	/** 在面板上显示一会儿“失败”，然后结束。 */
	private fail(session: Session, reason: string) {
		if (this.session !== session || session.progress.status === "error") return;
		writeDiagnostic("scroll-capture-failed", { reason });
		session.finishing = true;
		session.progress = { ...session.progress, status: "error" };
		this.notifyPanel(session);
		setTimeout(() => {
			if (this.session === session) this.cancel("failed");
		}, ERROR_DISPLAY_MS);
	}

	async finish(reason: string) {
		const session = this.session;
		if (!session || session.finishing) return;
		session.finishing = true;
		session.progress = { ...session.progress, status: "finishing" };
		this.notifyPanel(session);
		const filePath = temporaryPath("scroll", "png");
		let image: NativeImage | null = null;
		let stats: unknown;
		try {
			const response = await this.deps.agent.request({ cmd: "scroll-finish", path: filePath }, FINISH_TIMEOUT_MS);
			stats = response?.stats;
			if (response?.ok) {
				const decoded = nativeImage.createFromBuffer(await fs.readFile(filePath));
				if (!decoded.isEmpty()) image = decoded;
			} else {
				writeDiagnostic("scroll-capture-finish-failed", { error: response?.error ?? "no response" });
			}
		} catch (error) {
			writeDiagnostic("scroll-capture-finish-failed", { error: serializeError(error) });
		} finally {
			await fs.unlink(filePath).catch(() => {});
		}
		if (this.session !== session) return;
		if (!image) {
			session.finishing = false;
			this.fail(session, "finish-failed");
			return;
		}
		this.end(session);
		// 只记数字：帧数、丢帧和原因
		writeDiagnostic("scroll-capture-finished", { reason, ...image.getSize(), ms: Date.now() - session.startedAt, stats });
		this.deps.onDone(image);
	}

	/** 取消，什么都不留。 */
	cancel(reason: string) {
		const session = this.session;
		if (!session) return;
		const ms = Date.now() - session.startedAt;
		void this.deps.agent
			.request({ cmd: "scroll-cancel" }, 2000)
			.then((response) => writeDiagnostic("scroll-capture-cancelled", { reason, ms, stats: response?.stats }));
		this.end(session);
		this.deps.onDone(null);
	}

	private end(session: Session) {
		if (this.session !== session) return;
		this.session = null;
		if (session.timer) clearTimeout(session.timer);
		if (this.deps.shortcutsEnabled) {
			for (const key of SHORTCUT_KEYS) {
				try {
					globalShortcut.unregister(key);
				} catch {
					// 本来就没注册上
				}
			}
		}
		for (const win of [session.panel, session.ring]) if (win && !win.isDestroyed()) win.destroy();
		void Promise.all([session.previewPath, `${session.previewPath}.part.jpg`].map((file) => fs.unlink(file).catch(() => {})));
	}
}
