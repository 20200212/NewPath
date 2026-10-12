import fs from "node:fs/promises";
import path from "node:path";

// 诊断日志：每行一个 JSON，记录截图、权限、快捷键等关键事件，方便用户遇到问题时把日志发过来。
// 只记事件和数字，不记截图内容、文件名、窗口标题等隐私信息。

/** 单个日志文件的上限；超过后改名为 .1（覆盖上一份），重新开始写。 */
const MAX_LOG_BYTES = 512 * 1024;
/** 初始化之前产生的事件先放在内存里，最多保留这么多条。 */
const MAX_EARLY_EVENTS = 200;
export const LOG_FILE_NAME = "newpath.log";

type Details = Record<string, unknown>;

export function serializeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

/** 一行日志：时间、事件名和附加信息；附加信息里的 Error 转成文字，不能序列化的值丢掉。 */
export function formatDiagnosticLine(event: string, details: Details | undefined, now: Date): string {
	const entry: Details = { time: now.toISOString(), event };
	for (const [key, item] of Object.entries(details ?? {})) {
		if (key === "time" || key === "event") continue;
		entry[key] = item instanceof Error ? item.message : item;
	}
	try {
		return `${JSON.stringify(entry)}\n`;
	} catch {
		return `${JSON.stringify({ time: entry.time, event, unserializable: true })}\n`;
	}
}

let logFile: string | null = null;
let size = 0;
let queue: Promise<void> = Promise.resolve();
let earlyLines: string[] = [];
let echo = false;

function append(line: string) {
	if (echo) process.stdout.write(`[diag] ${line}`);
	if (!logFile) {
		earlyLines.push(line);
		if (earlyLines.length > MAX_EARLY_EVENTS) earlyLines.shift();
		return;
	}
	const file = logFile;
	queue = queue
		.then(async () => {
			const bytes = Buffer.byteLength(line);
			if (size + bytes > MAX_LOG_BYTES) {
				await fs.rename(file, `${file}.1`).catch(() => {});
				size = 0;
			}
			await fs.appendFile(file, line, "utf8");
			size += bytes;
		})
		.catch(() => {
			// 日志写不进去不影响功能
		});
}

/** 指定日志目录后开始写文件；echo 为 true 时同时打印到终端（开发模式）。 */
export async function initDiagnostics(dir: string, options: { echo?: boolean } = {}) {
	echo = options.echo ?? false;
	await fs.mkdir(dir, { recursive: true }).catch(() => {});
	logFile = path.join(dir, LOG_FILE_NAME);
	size = await fs.stat(logFile).then(
		(stat) => stat.size,
		() => 0,
	);
	const pending = earlyLines;
	earlyLines = [];
	const wasEcho = echo;
	// 初始化之前的事件已经打印过了，这里只补写到文件
	echo = false;
	for (const line of pending) append(line);
	echo = wasEcho;
}

export function writeDiagnostic(event: string, details?: Details) {
	append(formatDiagnosticLine(event, details, new Date()));
}

/** 等所有待写的日志落盘（退出前、测试里用）。 */
export function flushDiagnostics(): Promise<void> {
	return queue;
}

export function diagnosticsDir(): string | null {
	return logFile ? path.dirname(logFile) : null;
}
