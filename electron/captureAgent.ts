import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

// 移植自 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）的 electron/captureAgent.ts。

export interface AgentResponse {
	id: number;
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

/** 截图进程主动发来的一行（不是对某个请求的回答），例如滚动截图的进度。 */
export interface AgentEvent {
	event: string;
	[key: string]: unknown;
}

interface Pending {
	resolve: (response: AgentResponse | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

type Diagnostic = (event: string, details?: Record<string, unknown>) => void;

/** 解析截图进程输出的一行回答；格式不对的一律忽略。 */
export function parseAgentLine(line: string): AgentResponse | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const { id, ok } = value as Record<string, unknown>;
	if (typeof id !== "number" || !Number.isInteger(id) || typeof ok !== "boolean") return null;
	return value as AgentResponse;
}

/** 解析截图进程主动发来的事件行；带 id 的是回答，不算事件。 */
export function parseAgentEvent(line: string): AgentEvent | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const { event, id } = value as Record<string, unknown>;
	if (typeof event !== "string" || !event || id !== undefined) return null;
	return value as AgentEvent;
}

/** 把流式输出切成完整的行，最后不完整的一段留到下次。 */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
	const parts = (buffer + chunk).split("\n");
	const rest = parts.pop() ?? "";
	return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

/**
 * 和 macOS 上常驻的截图进程（native/newpath-capture-agent，基于 ScreenCaptureKit）按行收发 JSON。
 * 每个请求失败或超时都返回 null，调用方再退回 /usr/sbin/screencapture 或 desktopCapturer。
 * 超时的进程会被重启；连续崩溃 3 次就停用一分钟。
 */
export class CaptureAgent {
	private child: ChildProcessWithoutNullStreams | null = null;
	private nextId = 0;
	private readonly pending = new Map<number, Pending>();
	private buffer = "";
	private crashes = 0;
	private pausedUntil = 0;
	private eventListener: ((event: AgentEvent) => void) | null = null;

	constructor(
		private readonly executable: string,
		private readonly diagnostic: Diagnostic,
		private readonly spawnProcess: typeof spawn = spawn,
	) {}

	start(): boolean {
		if (this.child) return true;
		if (Date.now() < this.pausedUntil) return false;
		let child: ChildProcessWithoutNullStreams;
		try {
			child = this.spawnProcess(this.executable, [], { stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			this.noteCrash("spawn-failed", error);
			return false;
		}
		this.child = child;
		this.buffer = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.handleOutput(chunk));
		child.stderr.resume();
		child.stdin.on("error", () => {});
		child.once("error", (error) => {
			if (this.child === child) this.handleExit(child, "error", error);
		});
		child.once("exit", (code, signal) => {
			if (this.child === child) this.handleExit(child, "exit", { code, signal });
		});
		return true;
	}

	stop() {
		const child = this.child;
		this.child = null;
		this.failPending();
		if (child) {
			child.stdin.end();
			child.kill();
			this.emit({ event: "stopped" });
		}
	}

	/** 接收截图进程主动发来的事件；进程退出时还会收到 {event: "stopped"}，它手上的工作也跟着没了。 */
	onEvent(listener: ((event: AgentEvent) => void) | null) {
		this.eventListener = listener;
	}

	private emit(event: AgentEvent) {
		try {
			this.eventListener?.(event);
		} catch (error) {
			this.diagnostic("capture-agent-event-failed", {
				event: event.event,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	request(command: Record<string, unknown>, timeoutMs: number): Promise<AgentResponse | null> {
		if (!this.start() || !this.child) return Promise.resolve(null);
		const child = this.child;
		const id = ++this.nextId;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				this.diagnostic("capture-agent-timeout", { cmd: command.cmd, timeoutMs });
				resolve(null);
				// 卡住的进程会拖慢之后每一次截图，直接重启
				if (this.child === child) this.stop();
			}, timeoutMs);
			this.pending.set(id, { resolve, timer });
			child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}

	private handleOutput(chunk: string) {
		const { lines, rest } = splitLines(this.buffer, chunk);
		this.buffer = rest;
		for (const line of lines) {
			const response = parseAgentLine(line);
			if (!response) {
				const event = parseAgentEvent(line);
				if (event) this.emit(event);
				continue;
			}
			const entry = this.pending.get(response.id);
			if (!entry) continue;
			this.pending.delete(response.id);
			clearTimeout(entry.timer);
			this.crashes = 0;
			entry.resolve(response);
		}
	}

	private handleExit(child: ChildProcessWithoutNullStreams, reason: string, details: unknown) {
		if (this.child !== child) return;
		this.child = null;
		this.failPending();
		this.noteCrash(reason, details);
		this.emit({ event: "stopped" });
	}

	private noteCrash(reason: string, details: unknown) {
		this.crashes += 1;
		this.diagnostic("capture-agent-stopped", {
			reason,
			details: details instanceof Error ? details.message : details,
			crashes: this.crashes,
		});
		if (this.crashes >= 3) {
			this.crashes = 0;
			this.pausedUntil = Date.now() + 60_000;
		}
	}

	private failPending() {
		for (const [id, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.resolve(null);
			this.pending.delete(id);
		}
	}
}
