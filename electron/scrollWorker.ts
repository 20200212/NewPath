import { parentPort } from "node:worker_threads";
import { FIXTURE_INTERVAL_MS, fixtureKeys, fixturePosition, renderFixtureFrame } from "./scrollFixture";
import { composePreview } from "./scrollPreview";
import { ScrollStitcher, type StitchOutcome, type StitchStats } from "./scrollStitcher";

/**
 * Windows 滚动截图的拼接线程（worker_threads）。主进程（windowsScrollAgent.ts）把助手截到的每一帧传进来，
 * 这里跑 ScrollStitcher，把进度和预览回报出去；完成时交回整张长图。
 * 和 macOS 截图进程 ScrollCapture.swift 的分工一样：状态 waiting / capturing / behind / lost / full，
 * 预览最多每 350ms 重写一次，但最后总会追上最新的内容。
 *
 * 这个文件单独打包成 dist-electron/scrollWorker.js，以 data: URL 的方式交给 Worker（见 windowsScrollAgent.ts），
 * 所以不能 import 主进程也用到的模块，否则会被拆成公共 chunk、在 data: URL 里找不到。
 */

type ScrollWorkerStatus = "waiting" | "capturing" | "behind" | "lost" | "full";

/** 开发夹具：一张长页（BGRA），在它上面模拟滚动。 */
export interface FixturePage {
	pixels: ArrayBuffer;
	width: number;
	height: number;
}

export type WorkerCommand =
	| { type: "start"; width: number; height: number; maxHeight: number; ignoredRight: number; fixture?: FixturePage }
	| { type: "frame"; data: ArrayBuffer; width: number; height: number }
	| { type: "finish" }
	| { type: "cancel" };

export type WorkerMessage =
	| { type: "started" }
	| { type: "frame-done" }
	| { type: "progress"; status: ScrollWorkerStatus; height: number; width: number }
	| { type: "preview"; width: number; height: number; pixels: ArrayBuffer }
	| { type: "finished"; width: number; height: number; pixels: ArrayBuffer | null; frames: number; stats: StitchStats }
	| { type: "cancelled"; stats: StitchStats }
	| { type: "error"; message: string };

const PREVIEW_INTERVAL_MS = 350;

const port = parentPort;
if (!port) throw new Error("scrollWorker 只能作为工作线程运行");

function post(message: WorkerMessage, transfer: ArrayBuffer[] = []) {
	port!.postMessage(message, transfer);
}

let stitcher: ScrollStitcher | null = null;
let status: ScrollWorkerStatus = "waiting";
let reportedStatus = "";
let reportedHeight = -1;
let frames = 0;
let previewWrittenAt = 0;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let fixtureTimer: ReturnType<typeof setInterval> | null = null;

function reset() {
	stitcher = null;
	status = "waiting";
	reportedStatus = "";
	reportedHeight = -1;
	frames = 0;
	previewWrittenAt = 0;
	if (previewTimer) clearTimeout(previewTimer);
	previewTimer = null;
	if (fixtureTimer) clearInterval(fixtureTimer);
	fixtureTimer = null;
}

function report() {
	if (!stitcher) return;
	reportedStatus = status;
	reportedHeight = stitcher.projectedHeight;
	post({ type: "progress", status, height: reportedHeight, width: stitcher.width });
}

function writePreview() {
	if (!stitcher) return;
	previewWrittenAt = Date.now();
	const preview = composePreview(stitcher.segments(), stitcher.width);
	if (!preview) return;
	const buffer = preview.pixels.buffer as ArrayBuffer;
	post({ type: "preview", width: preview.width, height: preview.height, pixels: buffer }, [buffer]);
}

/** 预览最多每 PREVIEW_INTERVAL_MS 重写一次，但最后总会追上最新的内容。 */
function schedulePreview() {
	if (previewTimer) return;
	const wait = PREVIEW_INTERVAL_MS - (Date.now() - previewWrittenAt);
	if (wait <= 0) {
		writePreview();
		return;
	}
	previewTimer = setTimeout(() => {
		previewTimer = null;
		if (stitcher) writePreview();
	}, wait);
}

function consume(frame: Uint8Array, bytesPerRow: number) {
	if (!stitcher) return;
	frames += 1;
	let outcome: StitchOutcome;
	try {
		outcome = stitcher.add(frame, bytesPerRow);
	} catch (error) {
		post({ type: "error", message: error instanceof Error ? error.message : String(error) });
		return;
	}
	if (outcome === "waiting") {
		status = "waiting";
		schedulePreview();
	} else if (typeof outcome === "object") {
		status = "capturing";
		schedulePreview();
	} else if (outcome === "behind") {
		status = "behind";
	} else if (outcome === "lost") {
		status = "lost";
	} else if (outcome === "full") {
		status = "full";
		schedulePreview();
	}
	if (status !== reportedStatus || stitcher.projectedHeight !== reportedHeight) report();
}

/** 开发夹具：按固定时间线在长页上滚动，每 33ms 产出一帧。 */
function startFixture(fixture: FixturePage, width: number, height: number) {
	const page = new Uint8Array(fixture.pixels);
	const pageHeight = Math.max(height, fixture.height);
	// 页面比一帧还矮时在下面补白
	const padded = new Uint8Array(width * pageHeight * 4).fill(255);
	padded.set(page.subarray(0, Math.min(page.length, padded.length)));
	const keys = fixtureKeys(pageHeight, height);
	const out = new Uint8Array(width * height * 4);
	const started = Date.now();
	fixtureTimer = setInterval(() => {
		if (!stitcher) return;
		const position = fixturePosition((Date.now() - started) / 1000, keys, pageHeight, height);
		renderFixtureFrame(padded, width, pageHeight, height, position, out);
		consume(out, width * 4);
	}, FIXTURE_INTERVAL_MS);
}

port.on("message", (command: WorkerCommand) => {
	switch (command.type) {
		case "start": {
			reset();
			try {
				stitcher = new ScrollStitcher({
					width: command.width,
					height: command.height,
					maxHeight: command.maxHeight,
					ignoredRight: command.ignoredRight,
				});
			} catch (error) {
				post({ type: "error", message: error instanceof Error ? error.message : String(error) });
				return;
			}
			if (command.fixture) {
				if (command.fixture.width !== command.width) {
					post({ type: "error", message: "fixture-width" });
					return;
				}
				startFixture(command.fixture, command.width, command.height);
			}
			post({ type: "started" });
			break;
		}
		case "frame": {
			if (stitcher && command.width === stitcher.width && command.height === stitcher.height) {
				consume(new Uint8Array(command.data), command.width * 4);
			}
			post({ type: "frame-done" });
			break;
		}
		case "finish": {
			const current = stitcher;
			if (!current) {
				post({ type: "error", message: "not-started" });
				return;
			}
			if (fixtureTimer) clearInterval(fixtureTimer);
			fixtureTimer = null;
			if (previewTimer) clearTimeout(previewTimer);
			previewTimer = null;
			const result = current.finish();
			const stats = current.stats();
			const count = frames;
			stitcher = null;
			if (!result) {
				post({ type: "finished", width: current.width, height: 0, pixels: null, frames: count, stats });
				return;
			}
			// 复制一份独立的缓冲再 transfer，避免把画布的大 ArrayBuffer 整个搬走
			const pixels = new Uint8Array(result.pixels.length);
			pixels.set(result.pixels);
			const buffer = pixels.buffer as ArrayBuffer;
			post({ type: "finished", width: current.width, height: result.rows, pixels: buffer, frames: count, stats }, [buffer]);
			break;
		}
		case "cancel": {
			const stats = stitcher?.stats() ?? { frames: 0, lost: 0, losses: 0, longestLoss: 0, notes: [] };
			reset();
			post({ type: "cancelled", stats });
			break;
		}
	}
});
