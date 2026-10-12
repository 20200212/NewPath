import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { nativeImage, screen } from "electron";
import type { AgentEvent, AgentResponse, ScrollAgent } from "./captureAgent";
import type { Rect } from "./ipcTypes";
import type { FixturePage, WorkerCommand, WorkerMessage } from "./scrollWorker";
import type { HelperFrame, WindowsHelper } from "./windowsHelper";

/**
 * Windows 上的滚动截图"截图进程"：对 ScrollCaptureController 说同一套 scroll-start / scroll-finish / scroll-cancel
 * 协议和 {"event":"scroll"} 事件，背后是助手进程（windowsHelper.ts，GDI BitBlt 连续截取选区）加一个
 * 工作线程（scrollWorker.ts，ScrollStitcher 拼接）。预览 JPEG 和最终 PNG 都按协议写到调用方给的路径。
 */

type Diagnostic = (event: string, details?: Record<string, unknown>) => void;

interface Deps {
	helper: WindowsHelper;
	/** 打包后的工作线程脚本（dist-electron/scrollWorker.js）。 */
	workerFile: string;
	diagnostic: Diagnostic;
}

interface Session {
	id: number;
	worker: Worker;
	width: number;
	height: number;
	previewPath: string | null;
	previewVersion: number;
	/** 正在拼接的帧；为空时才把下一帧发给工作线程，更快的帧直接覆盖等待中的那一帧。 */
	busy: boolean;
	pendingFrame: HelperFrame | null;
	dropped: number;
	finishing: boolean;
	fixture: boolean;
	startedAt: number;
}

const JPEG_QUALITY = 82;

export class WindowsScrollAgent implements ScrollAgent {
	private session: Session | null = null;
	private listener: ((event: AgentEvent) => void) | null = null;
	private workerSource: string | null = null;

	constructor(private readonly deps: Deps) {
		deps.helper.onExit(() => {
			const session = this.session;
			if (session && !session.finishing) {
				this.deps.diagnostic("scroll-helper-exited", { ms: Date.now() - session.startedAt });
				this.emit({ event: "stopped" });
			}
		});
	}

	onEvent(listener: ((event: AgentEvent) => void) | null) {
		this.listener = listener;
	}

	private emit(event: AgentEvent) {
		try {
			this.listener?.(event);
		} catch (error) {
			this.deps.diagnostic("scroll-agent-event-failed", { event: event.event, error: error instanceof Error ? error.message : String(error) });
		}
	}

	stop() {
		const session = this.session;
		this.session = null;
		if (session) {
			void this.deps.helper.stopScroll();
			void session.worker.terminate();
		}
	}

	async request(command: Record<string, unknown>, timeoutMs: number): Promise<AgentResponse | null> {
		const id = typeof command.id === "number" ? command.id : 0;
		const respond = (body: Record<string, unknown>): AgentResponse => ({ id, ok: true, ...body });
		const fail = (error: string): AgentResponse => ({ id, ok: false, error });
		try {
			switch (command.cmd) {
				case "scroll-start":
					return await withTimeout(this.start(command, respond, fail), timeoutMs, () => fail("timeout"));
				case "scroll-finish":
					return await withTimeout(this.finish(command, respond, fail), timeoutMs, () => fail("timeout"));
				case "scroll-cancel":
					return respond({ stats: this.cancel() });
				default:
					return fail("unsupported");
			}
		} catch (error) {
			this.deps.diagnostic("scroll-agent-failed", { cmd: command.cmd, error: error instanceof Error ? error.message : String(error) });
			return fail("internal");
		}
	}

	private async start(
		command: Record<string, unknown>,
		respond: (body: Record<string, unknown>) => AgentResponse,
		fail: (error: string) => AgentResponse,
	): Promise<AgentResponse> {
		if (this.session) this.cancel();
		const size = command.size as { width?: unknown; height?: unknown } | undefined;
		const width = Number(size?.width);
		const height = Number(size?.height);
		const pixelRect = command.pixelRect as Rect | undefined;
		const displayId = Number(command.display);
		const maxHeight = Number(command.maxHeight) || 15000;
		const rect = command.rect as Rect | undefined;
		const fixturePath = typeof command.fixture === "string" ? command.fixture : null;
		if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) return fail("bad-request");

		// 右侧不参与匹配的列数（避开滚动时才出现的浮动滚动条），和 macOS 截图进程一致：16 点换算成像素
		const ignoredRight = rect && rect.width > 0 ? Math.round((16 * width) / rect.width) : 16;
		let fixture: FixturePage | undefined;
		let globalRect: Rect | null = null;
		if (fixturePath) {
			const page = nativeImage.createFromPath(fixturePath);
			if (page.isEmpty()) return fail("fixture-unreadable");
			const scaled = page.resize({ width, quality: "best" });
			const pageSize = scaled.getSize();
			const bitmap = scaled.toBitmap();
			const pixels = new Uint8Array(bitmap.length);
			pixels.set(bitmap);
			fixture = { pixels: pixels.buffer as ArrayBuffer, width: pageSize.width, height: pageSize.height };
		} else {
			if (!pixelRect || !Number.isInteger(displayId)) return fail("bad-request");
			const display = screen.getAllDisplays().find((item) => item.id === displayId);
			if (!display) return fail("display-not-found");
			// 选区是显示器画面里的物理像素；助手要的是全局物理坐标
			const origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y });
			globalRect = { x: origin.x + pixelRect.x, y: origin.y + pixelRect.y, width, height };
		}

		const worker = new Worker(this.workerUrl());
		const session: Session = {
			id: typeof command.id === "number" ? command.id : 0,
			worker,
			width,
			height,
			previewPath: typeof command.preview === "string" ? command.preview : null,
			previewVersion: 0,
			busy: false,
			pendingFrame: null,
			dropped: 0,
			finishing: false,
			fixture: !!fixture,
			startedAt: Date.now(),
		};
		this.session = session;
		worker.on("message", (message: WorkerMessage) => this.onWorkerMessage(session, message));
		worker.on("error", (error) => {
			this.deps.diagnostic("scroll-worker-error", { error: error.message });
			if (this.session === session && !session.finishing) this.emit({ event: "stopped" });
		});

		const started = this.waitFor(session, (message) => message.type === "started" || message.type === "error");
		const startCommand: WorkerCommand = { type: "start", width, height, maxHeight, ignoredRight, ...(fixture ? { fixture } : {}) };
		worker.postMessage(startCommand, fixture ? [fixture.pixels] : []);
		const reply = await started;
		if (!reply || reply.type !== "started") {
			this.cancel();
			return fail(reply?.type === "error" ? reply.message : "worker");
		}
		if (globalRect) {
			const ok = await this.deps.helper.startScroll(globalRect, (frame) => this.onFrame(session, frame));
			if (!ok) {
				this.cancel();
				return fail("helper-rejected");
			}
		}
		if (this.session !== session) return fail("cancelled");
		return respond({ width, height });
	}

	private onFrame(session: Session, frame: HelperFrame) {
		if (this.session !== session || session.finishing) return;
		if (frame.width !== session.width || frame.height !== session.height) {
			this.deps.diagnostic("scroll-frame-size-mismatch", { width: frame.width, height: frame.height });
			return;
		}
		if (session.busy) {
			if (session.pendingFrame) session.dropped += 1;
			session.pendingFrame = frame;
			return;
		}
		this.sendFrame(session, frame);
	}

	private sendFrame(session: Session, frame: HelperFrame) {
		session.busy = true;
		const command: WorkerCommand = { type: "frame", data: frame.data, width: frame.width, height: frame.height };
		session.worker.postMessage(command, [frame.data]);
	}

	private onWorkerMessage(session: Session, message: WorkerMessage) {
		if (this.session !== session) return;
		switch (message.type) {
			case "frame-done": {
				session.busy = false;
				const next = session.pendingFrame;
				session.pendingFrame = null;
				if (next && !session.finishing) this.sendFrame(session, next);
				break;
			}
			case "progress":
				this.emitProgress(session, message.status, message.height, message.width);
				break;
			case "preview":
				void this.writePreview(session, message);
				break;
			case "error":
				this.deps.diagnostic("scroll-worker-error", { error: message.message });
				if (!session.finishing) this.emit({ event: "stopped" });
				break;
			default:
				break;
		}
	}

	private lastProgress: { status: string; height: number; width: number } | null = null;

	private emitProgress(session: Session, status: string, height: number, width: number) {
		this.lastProgress = { status, height, width };
		this.emit({ event: "scroll", session: session.id, status, height, width, preview: session.previewVersion });
	}

	/** 预览先写成 .part.jpg 再改名，面板读到的总是完整文件；版本号加一后再报一次进度。 */
	private async writePreview(session: Session, message: { width: number; height: number; pixels: ArrayBuffer }) {
		if (!session.previewPath) return;
		try {
			const image = nativeImage.createFromBitmap(Buffer.from(message.pixels), { width: message.width, height: message.height });
			const jpeg = image.toJPEG(JPEG_QUALITY);
			const partPath = `${session.previewPath}.part.jpg`;
			await fs.writeFile(partPath, jpeg);
			await fs.rename(partPath, session.previewPath);
		} catch (error) {
			this.deps.diagnostic("scroll-preview-failed", { error: error instanceof Error ? error.message : String(error) });
			return;
		}
		if (this.session !== session) return;
		session.previewVersion += 1;
		const progress = this.lastProgress ?? { status: "waiting", height: session.height, width: session.width };
		this.emitProgress(session, progress.status, progress.height, progress.width);
	}

	private async finish(
		command: Record<string, unknown>,
		respond: (body: Record<string, unknown>) => AgentResponse,
		fail: (error: string) => AgentResponse,
	): Promise<AgentResponse> {
		const session = this.session;
		const filePath = typeof command.path === "string" ? command.path : null;
		if (!session) return fail("no-scroll");
		if (!filePath) return fail("bad-request");
		session.finishing = true;
		session.pendingFrame = null;
		if (!session.fixture) await this.deps.helper.stopScroll();
		const done = this.waitFor(session, (message) => message.type === "finished" || message.type === "error");
		session.worker.postMessage({ type: "finish" } satisfies WorkerCommand);
		const reply = await done;
		this.end(session);
		if (!reply || reply.type !== "finished") return fail(reply?.type === "error" ? reply.message : "worker");
		if (!reply.pixels || reply.height <= 0) return fail("no-frames");
		const image = nativeImage.createFromBitmap(Buffer.from(reply.pixels), { width: reply.width, height: reply.height });
		await fs.writeFile(filePath, image.toPNG());
		return respond({
			width: reply.width,
			height: reply.height,
			frames: reply.frames,
			stats: { ...reply.stats, dropped: session.dropped },
		});
	}

	/** 取消并丢掉一切；返回诊断数字。 */
	private cancel(): Record<string, unknown> {
		const session = this.session;
		if (!session) return {};
		session.finishing = true;
		if (!session.fixture) void this.deps.helper.stopScroll();
		this.end(session);
		return { dropped: session.dropped, ms: Date.now() - session.startedAt };
	}

	private end(session: Session) {
		if (this.session === session) this.session = null;
		this.lastProgress = null;
		void session.worker.terminate();
	}

	private waitFor(session: Session, match: (message: WorkerMessage) => boolean): Promise<WorkerMessage | null> {
		return new Promise((resolve) => {
			const onMessage = (message: WorkerMessage) => {
				if (!match(message)) return;
				cleanup();
				resolve(message);
			};
			const onExit = () => {
				cleanup();
				resolve(null);
			};
			const cleanup = () => {
				session.worker.off("message", onMessage);
				session.worker.off("exit", onExit);
				session.worker.off("error", onExit);
			};
			session.worker.on("message", onMessage);
			session.worker.once("exit", onExit);
			session.worker.once("error", onExit);
		});
	}

	/**
	 * 工作线程的脚本以 data: URL 启动：打包后文件在 app.asar 里，fs 读得到（Electron 给 fs 打了补丁），
	 * 但 worker_threads 不一定能直接从 asar 加载。脚本是独立打包的 ES 模块，只 import Node 内置模块，
	 * 所以 data: URL 也能加载（见 vite.config.ts 的 scrollWorker 入口）。
	 */
	private workerUrl(): URL {
		if (this.workerSource === null) this.workerSource = readFileSync(this.deps.workerFile, "utf8");
		return new URL(`data:text/javascript;base64,${Buffer.from(this.workerSource, "utf8").toString("base64")}`);
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(onTimeout());
			},
		);
	});
}
