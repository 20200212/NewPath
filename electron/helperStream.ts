/**
 * Windows 助手进程（electron/windowsHelper.ts）的 stdout 既有文本行，也有滚动截图的原始帧：
 *
 *   <文本行>\n
 *   frame <序号> <宽> <高> <字节数>\n<原始 BGRA 字节>
 *
 * 这个解析器把字节流切成消息；帧的像素被拷进新的 ArrayBuffer，4 字节对齐，可以直接 transfer 给工作线程。
 */

export type HelperMessage =
	| { kind: "line"; text: string }
	| { kind: "frame"; seq: number; width: number; height: number; data: ArrayBuffer };

const FRAME_PREFIX = "frame ";
/** 帧头声明的字节数上限，防止格式错误时无限等待。 */
const MAX_FRAME_BYTES = 512 * 1024 * 1024;

interface PendingFrame {
	seq: number;
	width: number;
	height: number;
	bytes: number;
}

/** 解析帧头 "frame <seq> <w> <h> <bytes>"；格式不对返回 null。 */
export function parseFrameHeader(line: string): PendingFrame | null {
	if (!line.startsWith(FRAME_PREFIX)) return null;
	const parts = line.slice(FRAME_PREFIX.length).split(" ");
	if (parts.length !== 4) return null;
	const [seq, width, height, bytes] = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
	if (![seq, width, height, bytes].every((value) => Number.isSafeInteger(value))) return null;
	if (width <= 0 || height <= 0 || bytes <= 0 || bytes > MAX_FRAME_BYTES || bytes < width * height * 4) return null;
	return { seq, width, height, bytes };
}

export class HelperStreamParser {
	private chunks: Buffer[] = [];
	private buffered = 0;
	private pending: PendingFrame | null = null;

	/** 喂入一段 stdout；返回这段里凑齐的消息（可能为空）。 */
	push(chunk: Buffer): HelperMessage[] {
		if (chunk.length === 0) return [];
		this.chunks.push(chunk);
		this.buffered += chunk.length;
		const messages: HelperMessage[] = [];
		for (;;) {
			if (this.pending) {
				if (this.buffered < this.pending.bytes) break;
				const data = this.take(this.pending.bytes);
				const copy = new ArrayBuffer(data.length);
				new Uint8Array(copy).set(data);
				messages.push({ kind: "frame", ...this.pending, data: copy });
				this.pending = null;
				continue;
			}
			const newline = this.indexOfNewline();
			if (newline < 0) break;
			const lineBytes = this.take(newline + 1);
			const text = lineBytes.toString("utf8", 0, lineBytes.length - 1).replace(/\r$/, "");
			const header = parseFrameHeader(text);
			if (header) {
				this.pending = header;
				continue;
			}
			if (text.trim().length > 0) messages.push({ kind: "line", text });
		}
		return messages;
	}

	/** 进程重启时丢掉半截数据。 */
	reset() {
		this.chunks = [];
		this.buffered = 0;
		this.pending = null;
	}

	private indexOfNewline(): number {
		let offset = 0;
		for (const chunk of this.chunks) {
			const index = chunk.indexOf(0x0a);
			if (index >= 0) return offset + index;
			offset += chunk.length;
		}
		return -1;
	}

	/** 取走开头的 count 个字节。 */
	private take(count: number): Buffer {
		const joined = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.buffered);
		const head = joined.subarray(0, count);
		const rest = joined.subarray(count);
		this.chunks = rest.length > 0 ? [rest] : [];
		this.buffered = rest.length;
		return head;
	}
}
