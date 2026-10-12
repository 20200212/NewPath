import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { desktopCapturer, nativeImage, type Display, type NativeImage, type Rectangle } from "electron";
import type { AgentResponse, CaptureAgent } from "./captureAgent";
import { serializeError, writeDiagnostic } from "./diagnostics";
import { findOpaqueBounds, interactiveCaptureArguments, regionCaptureArguments, windowCaptureArguments } from "./windowCapture";

const SCREENCAPTURE = "/usr/sbin/screencapture";
const AGENT_DISPLAY_TIMEOUT_MS = 1500;
const AGENT_CROP_TIMEOUT_MS = 2000;
const AGENT_WINDOW_TIMEOUT_MS = 2000;
const SCREENCAPTURE_TIMEOUT_MS = 4000;
/** 系统框选最多等这么久，用户忘了按 Esc 时自动结束。 */
const INTERACTIVE_TIMEOUT_MS = 2 * 60 * 1000;
/** 给选区窗口显示的 JPEG 质量：只用于显示，裁剪用原图。 */
const PREVIEW_JPEG_QUALITY = 92;

export type FrameSource = "agent" | "screencapture" | "desktop-capturer" | "fixture";

/**
 * 一次截图的冻结画面。选区窗口显示 previewJpeg，最终按选区从原图裁剪：
 * 截图进程（ScreenCaptureKit）截的原图留在它自己的内存里，用 crop 命令取；其他来源的原图在主进程里。
 */
export interface CaptureFrame {
	source: FrameSource;
	/** 原图尺寸（物理像素）。 */
	size: { width: number; height: number };
	previewJpeg: Buffer;
	/** rect 是原图像素。 */
	crop(rect: Rectangle): Promise<NativeImage | null>;
	/** 用完后释放截图进程里保留的原图。 */
	release(): void;
}

/** 原图已经在主进程里的画面。 */
export function imageFrame(image: NativeImage, source: FrameSource): CaptureFrame {
	return {
		source,
		size: image.getSize(),
		previewJpeg: image.toJPEG(PREVIEW_JPEG_QUALITY),
		crop: async (rect) => {
			const cropped = image.crop(rect);
			return cropped.isEmpty() ? null : cropped;
		},
		release: () => {},
	};
}

function temporaryPath(prefix: string, extension: "png" | "jpg") {
	return path.join(os.tmpdir(), `newpath-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
}

function readImage(bytes: Buffer): NativeImage | null {
	const image = nativeImage.createFromBuffer(bytes);
	return image.isEmpty() ? null : image;
}

function execScreencapture(args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(SCREENCAPTURE, args, { timeout: timeoutMs }, (error) => (error ? reject(error) : resolve()));
	});
}

/** 显示器的物理像素尺寸，和 desktopCapturer、截图进程返回的画面一致。 */
function displayPixels(display: Display) {
	return {
		width: Math.round(display.size.width * display.scaleFactor),
		height: Math.round(display.size.height * display.scaleFactor),
	};
}

interface CapturerOptions {
	/** macOS 上常驻的截图进程；其他平台、开发夹具模式下为 null。 */
	agent: CaptureAgent | null;
	/** 开发模式下代替屏幕的 PNG（NEWPATH_DEV_CAPTURE_FILE）。 */
	fixtureFile: string | null;
}

/**
 * 截屏的各种来源，按平台和可用性依次尝试：
 * macOS：截图进程（macOS 14 起的 ScreenCaptureKit）→ /usr/sbin/screencapture → desktopCapturer；
 * 其他平台：desktopCapturer。开发夹具模式下直接读图片。
 */
export class ScreenCapturer {
	private interactive: ChildProcess | null = null;

	constructor(private readonly options: CapturerOptions) {}

	get usesFixture() {
		return this.options.fixtureFile !== null;
	}

	async captureDisplay(display: Display): Promise<CaptureFrame | null> {
		const startedAt = Date.now();
		const done = (frame: CaptureFrame | null) => {
			if (frame) writeDiagnostic("display-capture", { via: frame.source, display: display.id, ms: Date.now() - startedAt, ...frame.size });
			return frame;
		};
		if (this.options.fixtureFile) return done(await this.readFixture(display));
		if (process.platform === "darwin") {
			const agentFrame = await this.captureWithAgent(display);
			if (agentFrame) return done(agentFrame);
			const native = await this.captureWithScreencapture(display);
			if (native) return done(native);
		}
		return done(await captureWithDesktopCapturer(display));
	}

	/** 开发夹具：缩放到显示器的物理像素尺寸，选区换算和真实截图一致。 */
	private async readFixture(display: Display): Promise<CaptureFrame | null> {
		try {
			const image = readImage(await fs.readFile(this.options.fixtureFile!));
			if (!image) throw new Error("夹具不是有效的 PNG / JPEG");
			return imageFrame(image.resize({ ...displayPixels(display), quality: "best" }), "fixture");
		} catch (error) {
			writeDiagnostic("fixture-capture-failed", { error: serializeError(error) });
			return null;
		}
	}

	/** 请截图进程把结果写进临时文件再读回来。 */
	private async agentRequest(
		command: Record<string, unknown>,
		extension: "png" | "jpg",
		timeoutMs: number,
	): Promise<{ bytes: Buffer; response: AgentResponse } | null> {
		const agent = this.options.agent;
		if (!agent) return null;
		const filePath = temporaryPath("agent", extension);
		try {
			const response = await agent.request({ ...command, path: filePath }, timeoutMs);
			if (!response?.ok) {
				if (response) writeDiagnostic("capture-agent-failed", { cmd: command.cmd, error: response.error });
				return null;
			}
			return { bytes: await fs.readFile(filePath), response };
		} catch (error) {
			writeDiagnostic("capture-agent-failed", { cmd: command.cmd, error: serializeError(error) });
			return null;
		} finally {
			await fs.unlink(filePath).catch(() => {});
		}
	}

	private async captureWithAgent(display: Display): Promise<CaptureFrame | null> {
		const result = await this.agentRequest({ cmd: "display", display: display.id }, "jpg", AGENT_DISPLAY_TIMEOUT_MS);
		if (!result) return null;
		const width = Number(result.response.width);
		const height = Number(result.response.height);
		const expected = displayPixels(display);
		// 选区窗口要的是这块显示器的全分辨率画面，尺寸对不上就换别的方式
		if (Math.abs(width - expected.width) > 2 || Math.abs(height - expected.height) > 2) {
			writeDiagnostic("capture-agent-size-mismatch", { display: display.id, width, height, expected });
			this.releaseAgentFrame();
			return null;
		}
		const previewJpeg = result.bytes;
		let released = false;
		return {
			source: "agent",
			size: { width, height },
			previewJpeg,
			crop: async (rect) => {
				if (!released) {
					const cropped = await this.agentRequest({ cmd: "crop", rect }, "png", AGENT_CROP_TIMEOUT_MS);
					const image = cropped ? readImage(cropped.bytes) : null;
					if (image) return image;
				}
				// 截图进程重启过、原图丢了：用预览图裁（质量略低，但不至于截图失败）
				writeDiagnostic("frame-crop-from-preview");
				const preview = readImage(previewJpeg);
				const image = preview?.crop(rect);
				return image && !image.isEmpty() ? image : null;
			},
			release: () => {
				if (released) return;
				released = true;
				this.releaseAgentFrame();
			},
		};
	}

	private releaseAgentFrame() {
		void this.options.agent?.request({ cmd: "release" }, 1000);
	}

	private async captureWithScreencapture(display: Display): Promise<CaptureFrame | null> {
		const filePath = temporaryPath("display", "png");
		try {
			await execScreencapture(regionCaptureArguments(display.bounds, filePath), SCREENCAPTURE_TIMEOUT_MS);
			const image = readImage(await fs.readFile(filePath));
			return image ? imageFrame(image, "screencapture") : null;
		} catch (error) {
			writeDiagnostic("screencapture-failed", { error: serializeError(error) });
			return null;
		} finally {
			await fs.unlink(filePath).catch(() => {});
		}
	}

	/**
	 * 按窗口编号（CGWindowID）单独截一个窗口：被其他窗口挡住的部分也完整，带透明圆角、不带阴影，裁到可见像素。
	 * 只在 macOS 上可用；窗口已经关掉（比如选区窗口抢走焦点后消失的菜单）时返回 null，调用方退回按选区裁剪。
	 */
	async captureWindow(windowId: number): Promise<NativeImage | null> {
		if (process.platform !== "darwin" || this.options.fixtureFile) return null;
		const startedAt = Date.now();
		const fromAgent = await this.agentRequest({ cmd: "window", window: windowId }, "png", AGENT_WINDOW_TIMEOUT_MS);
		const agentImage = fromAgent ? readImage(fromAgent.bytes) : null;
		if (agentImage) {
			// 截图进程已经裁掉了透明边
			writeDiagnostic("window-capture", { via: "agent", ms: Date.now() - startedAt });
			return agentImage;
		}
		const filePath = temporaryPath("window", "png");
		try {
			await execScreencapture(windowCaptureArguments(windowId, filePath), 5000);
			const image = readImage(await fs.readFile(filePath));
			if (!image) throw new Error("窗口截图是空的");
			const size = image.getSize();
			const bounds = findOpaqueBounds(image.toBitmap(), size.width, size.height);
			if (!bounds) throw new Error("窗口截图是全透明的");
			const trimmed = bounds.width === size.width && bounds.height === size.height ? image : image.crop(bounds);
			writeDiagnostic("window-capture", { via: "screencapture", ms: Date.now() - startedAt, ...bounds });
			return trimmed;
		} catch (error) {
			writeDiagnostic("window-capture-failed", { error: serializeError(error) });
			return null;
		} finally {
			await fs.unlink(filePath).catch(() => {});
		}
	}

	/**
	 * macOS 系统自带的框选（screencapture -i）。按 Esc 取消时 image 为 null、failed 为 false；
	 * failed 为 true 表示 screencapture 自己出错了，通常是没有屏幕录制权限。
	 */
	async captureInteractive(): Promise<{ image: NativeImage | null; failed: boolean }> {
		if (this.options.fixtureFile) {
			const image = readImage(await fs.readFile(this.options.fixtureFile).catch(() => Buffer.alloc(0)));
			return { image, failed: !image };
		}
		this.cancelInteractive();
		const filePath = temporaryPath("selection", "png");
		const startedAt = Date.now();
		try {
			const exitCode = await new Promise<number | null>((resolve, reject) => {
				const child = execFile(SCREENCAPTURE, interactiveCaptureArguments(filePath), { timeout: INTERACTIVE_TIMEOUT_MS });
				this.interactive = child;
				child.once("error", reject);
				child.once("close", (code) => resolve(code));
			});
			if (exitCode !== 0) {
				writeDiagnostic("interactive-capture-failed", { code: exitCode, ms: Date.now() - startedAt });
				return { image: null, failed: exitCode !== null };
			}
			// Esc 不会留下文件
			const bytes = await fs.readFile(filePath).catch(() => null);
			const image = bytes ? readImage(bytes) : null;
			writeDiagnostic("interactive-capture", { selected: !!image, ms: Date.now() - startedAt });
			return { image, failed: false };
		} catch (error) {
			writeDiagnostic("interactive-capture-failed", { error: serializeError(error) });
			return { image: null, failed: true };
		} finally {
			this.interactive = null;
			await fs.unlink(filePath).catch(() => {});
		}
	}

	/** 结束正在进行的系统框选（例如再次按下截图快捷键、退出应用）。 */
	cancelInteractive() {
		const child = this.interactive;
		this.interactive = null;
		if (child && child.exitCode === null) child.kill("SIGTERM");
	}

	get interactiveRunning() {
		return this.interactive !== null;
	}
}

/**
 * Electron 自带的截屏（所有平台都能用，macOS 上是最后的退路）。
 * macOS 未授予屏幕录制权限时可能返回空图片或只有桌面壁纸的画面，调用方需要检查权限。
 */
async function captureWithDesktopCapturer(display: Display): Promise<CaptureFrame | null> {
	try {
		const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: displayPixels(display) });
		const source =
			sources.find((item) => item.display_id === String(display.id)) ??
			(sources.length === 1 ? sources[0] : undefined);
		if (!source || source.thumbnail.isEmpty()) return null;
		return imageFrame(source.thumbnail, "desktop-capturer");
	} catch (error) {
		writeDiagnostic("desktop-capturer-failed", { error: serializeError(error) });
		return null;
	}
}
