// 按 QuickShot（GPL-3.0-or-later，https://github.com/cclank/quickshot）的 ScrollStitcher.swift 用 TypeScript 重新实现。
//
// 把正在滚动的一块区域逐帧拼成一张长图。
//
// 帧是 32 位 BGRA。每帧都和它的上一帧（只早几十毫秒）比较，所以原地变化的内容
// （懒加载的图片、渐显、跳动的时钟、悬停高亮）不会让拼接器一直拿着过期的参照帧。
// 顶部、底部不动的行（工具栏、吸顶标题、页脚）不参与搜索；行按列段比较，
// 一行里局部变化不会挡住其余部分的匹配。列段像素基本一致、或者形状相关时算匹配，
// 所以滚进来时逐渐变深的文字也能对上；其余部分在滚、自己不动的列（吸顶侧栏）完全不参与匹配。
//
// 长图是以第一帧为坐标的画布。每张拼进来的帧都把它显示的行画到画布上，所以每一行保留最后一次
// 看到的样子：加载好的图片替换占位图，浮动按钮只留在最后看到它的地方。固定的顶部栏来自第一帧，
// 固定的底部栏来自滚得最远的那一帧；吸顶侧栏只出现一次，下面是它的背景。
//
// 第一次向下滚动之前，拼接器一直跟着最新的一帧：窗口可以先稳定下来（NewPath 让开后它才变成活动窗口），
// 用户也可以先往上滚到想要开始的地方。
//
// 纯逻辑，不依赖 Electron，可以单独测试（见 scrollStitcher.test.ts）。

export type StitchOutcome =
	/** 画面没有滚动，内容可能原地变了。 */
	| "unchanged"
	/** 还没开始，这一帧成为新的起点。 */
	| "waiting"
	/** 长图增加了这么多行。 */
	| { appended: number }
	/** 往回滚到了长图里已经有的行。 */
	| "behind"
	/** 和上一帧找不到重叠，比如滚得非常快。 */
	| "lost"
	/** 长图达到 `maxHeight`，之后的帧都不再处理。 */
	| "full";

/** 诊断日志用的数字，从不包含图像内容。 */
export interface StitchStats {
	frames: number;
	lost: number;
	losses: number;
	longestLoss: number;
	notes: string[];
}

/** 参与比较的列的亮度，以及每行、每个列段的摘要。 */
interface Analysis {
	/** 每行 `columns` 个亮度值。 */
	luma: Uint8Array;
	/** 行哈希的两路 32 位值。 */
	hashesA: Uint32Array;
	hashesB: Uint32Array;
	/** 有细节的行，即不是一种纯色（0 / 1）。 */
	detailed: Uint8Array;
	/** 同上，按列段，每行 `SEGMENTS` 个。 */
	segmentDetailed: Uint8Array;
	segmentHashesA: Uint32Array;
	segmentHashesB: Uint32Array;
	/** 每行在 `PROFILE_BANDS` 个列带上的亮度和。 */
	profile: Int32Array;
}

const SEGMENTS = 16;
const PROFILE_BANDS = 8;
/** 亮度差超过这么多才算真的不同，而不是噪声。 */
const TOLERANCE = 24;
/** 有细节的列段里，至少要有这么大比例对得上才算匹配。 */
const MINIMUM_SCORE = 0.6;
/** 精确匹配的列段达到这么多，单凭它们就足以确定位移。 */
const CONVINCING_VOTES = 24;

// 哈希：Swift 版用 64 位 FNV-1a。JS 里 BigInt 太慢，改成两路 32 位哈希，比较时两路都相等才算相等。
// 第一路是标准 32 位 FNV-1a；第二路换了 offset basis 和乘数，并把字节复制到四个字节位再异或，
// 让两路的碰撞彼此无关。两路合起来接近 64 位的区分度；就算偶尔碰撞，后面还有逐像素的 score 校验兜底。
const FNV_BASIS_A = 0x811c9dc5;
const FNV_PRIME_A = 16777619;
const FNV_BASIS_B = 0x9e3779b9;
const FNV_PRIME_B = 0x5bd1e995;

/**
 * 把两路 32 位哈希拼成 Map 能用的 Number 键：A 的全部 32 位加 B 的高 21 位，正好 53 位，不丢精度。
 * 丢掉 B 的低 11 位会略微增加碰撞，但碰撞只会多投几张票，候选位移后面都要过 score 校验，代价可以接受。
 */
function hashKey(a: number, b: number): number {
	return a * 2097152 + (b >>> 11);
}

/** 用一个像素（4 字节）填满 `count` 个像素：先写一个，再成倍地 copyWithin。 */
function fillPixels(target: Uint8Array, offset: number, count: number, pixel: Uint8Array): void {
	if (count <= 0) return;
	const total = count * 4;
	target.set(pixel, offset);
	let done = 4;
	while (done < total) {
		const chunk = Math.min(done, total - done);
		target.copyWithin(offset + done, offset, offset + chunk);
		done += chunk;
	}
}

export class ScrollStitcher {
	readonly width: number;
	readonly height: number;
	readonly maxHeight: number;
	/** 从左边算起参与比较的列数。剩下的部分（滚动时出现浮动滚动条的地方）照样拷贝，但不比较。 */
	readonly columns: number;

	/** 开发用：描述每一步的判断。截图进程里为 null。 */
	trace: ((message: string) => void) | null = null;

	private readonly rowBytes: number;
	private readonly segmentWidth: number;

	/** 截图过程中是画布（容量按倍增扩，只有前 `canvasRows` 行有效）；`finish()` 之后是拼好的长图。 */
	private output: Uint8Array = new Uint8Array(0);
	private outputRows = 0;
	private finished: Uint8Array | null = null;
	private full = false;
	/** 是否已经开始，即是否向下滚过。 */
	private begun = false;

	private previous: Analysis | null = null;
	/** 上一帧的像素，开始之前一直保留。 */
	private previousPixels: Uint8Array | null = null;
	/** 上一帧相对第一帧滚了多远。 */
	private previousScroll = 0;
	private lastShift = 0;
	/** 连续多少帧没能拼上。 */
	private lostStreak = 0;
	private seen = 0;
	private lostFrames = 0;
	private episodes = 0;
	private longest = 0;
	/** 每次丢失时第一帧的情况，例如 "f212 band 1180 max 1062 last 240 best 310@0.41/12v still 0.08"。 */
	private notes: string[] = [];
	private attempt = "";
	/** 页面滚动时不动的列段（吸顶侧栏）：它们说明不了滚动，匹配时跳过。 */
	private stillColumns: Uint8Array = new Uint8Array(SEGMENTS);
	/** 帧里这一行以上是固定的顶部栏，取自第一帧。 */
	private headerRows = 0;
	private canvasRows = 0;
	/** 滚得最远的那一帧提供固定的底部栏。 */
	private deepestScroll = 0;
	private deepestBottom = 0;
	private footer: Uint8Array;
	private footerRows = 0;
	/** 用来在 32 位像素值和 4 个字节之间转换，顺便适配本机字节序。 */
	private readonly scratch32 = new Uint32Array(1);
	private readonly scratch8 = new Uint8Array(this.scratch32.buffer);

	/**
	 * @param options.ignoredRight 右侧不参与匹配的列数，用来避开滚动时才出现的浮动滚动条。
	 */
	constructor(options: { width: number; height: number; maxHeight: number; ignoredRight?: number }) {
		const { width, height, maxHeight, ignoredRight = 0 } = options;
		if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
			throw new RangeError("ScrollStitcher 需要正整数的宽高");
		}
		this.width = width;
		this.height = height;
		this.maxHeight = Math.max(height, Math.trunc(maxHeight));
		this.columns = Math.max(1, width - Math.min(Math.max(0, Math.trunc(ignoredRight)), Math.trunc(width / 4)));
		this.rowBytes = width * 4;
		this.segmentWidth = Math.max(1, Math.trunc(this.columns / SEGMENTS));
		this.footer = new Uint8Array(this.rowBytes * height);
	}

	get started(): boolean {
		return this.begun;
	}

	get isFull(): boolean {
		return this.full;
	}

	/** 最近拼上的那一帧相对第一帧滚了多少行。 */
	get scrollOffset(): number {
		return this.previousScroll;
	}

	/** 现在结束的话长图有多高。 */
	get projectedHeight(): number {
		if (!this.previous) return 0;
		return this.begun ? Math.min(this.maxHeight, this.deepestScroll + this.height) : this.height;
	}

	get framesSeen(): number {
		return this.seen;
	}

	get framesLost(): number {
		return this.lostFrames;
	}

	get lostEpisodes(): number {
		return this.episodes;
	}

	get longestLoss(): number {
		return this.longest;
	}

	get lossNotes(): readonly string[] {
		return this.notes;
	}

	stats(): StitchStats {
		return {
			frames: this.seen,
			lost: this.lostFrames,
			losses: this.episodes,
			longestLoss: this.longest,
			notes: [...this.notes],
		};
	}

	/** 加入一帧。`frame` 从第一行开始，每行 `bytesPerRow` 字节（不小于 width * 4）。 */
	add(frame: Uint8Array, bytesPerRow: number): StitchOutcome {
		if (this.full) return "full";
		if (!Number.isInteger(bytesPerRow) || bytesPerRow < this.rowBytes) {
			throw new RangeError(`bytesPerRow ${bytesPerRow} 小于 width * 4`);
		}
		if (frame.length < (this.height - 1) * bytesPerRow + this.rowBytes) {
			throw new RangeError("帧数据不够一整帧");
		}
		this.seen += 1;
		const current = this.analyze(frame, bytesPerRow);
		const last = this.previous;
		if (!last) {
			this.follow(current, frame, bytesPerRow);
			return "waiting";
		}

		const height = this.height;
		let top = 0;
		while (top < height && this.rowStays(last, current, top)) top += 1;
		if (top === height) return "unchanged";
		let bottom = height;
		while (bottom > top && this.rowStays(last, current, bottom - 1)) bottom -= 1;

		const shift = this.findShift(last, current, top, bottom);
		this.trace?.(`band ${top}..<${bottom} shift ${shift === null ? "none" : shift}`);
		if (shift === null) {
			if (this.begun) {
				this.lostStreak += 1;
				this.lostFrames += 1;
				this.longest = Math.max(this.longest, this.lostStreak);
				if (this.lostStreak === 1) {
					this.episodes += 1;
					if (this.notes.length < 12) {
						this.notes.push(`f${this.seen} band ${top}..<${bottom} last ${this.lastShift} ${this.attempt}`);
					}
				}
				return "lost";
			}
			this.follow(current, frame, bytesPerRow);
			return "waiting";
		}
		if (!this.begun) {
			if (shift <= 0) {
				this.follow(current, frame, bytesPerRow);
				return "waiting";
			}
			this.begin(top, bottom);
		}

		const scroll = this.previousScroll + shift;
		if (scroll + height > this.maxHeight) {
			this.full = true;
			return "full";
		}
		// 永远不在画布已有内容的下面留缺口。原地变化时，变化区上面的行就是页面本身，能填上。
		if (shift !== 0 && scroll + Math.max(top, this.headerRows) > this.canvasRows) return "lost";
		const before = this.projectedHeight;
		if (shift !== 0) this.stillColumns = this.stillSegments(last, current, shift, top, bottom);
		this.paint(frame, bytesPerRow, scroll, top, bottom, shift !== 0, this.stillColumns);
		this.previous = current;
		this.previousScroll = scroll;
		this.lostStreak = 0;
		if (shift !== 0) this.lastShift = shift;
		// 比最深处只差几行，是页面到底后的回弹，不是用户往上滚。
		if (this.deepestScroll - scroll > Math.trunc(height / 10)) return "behind";
		const grown = this.projectedHeight - before;
		return grown > 0 ? { appended: grown } : "unchanged";
	}

	/** 完成并返回长图（BGRA，每行 width * 4 字节）；一帧都没有时返回 null。 */
	finish(): { pixels: Uint8Array; rows: number } | null {
		if (!this.previous) return null;
		const rowBytes = this.rowBytes;
		let pixels: Uint8Array;
		if (this.begun) {
			const rows = Math.min(this.canvasRows, this.deepestScroll + this.deepestBottom);
			this.outputRows = Math.min(this.maxHeight, rows + this.height - this.deepestBottom);
			this.ensureCanvas(this.outputRows * rowBytes);
			const footerBytes = Math.max(0, this.outputRows - rows) * rowBytes;
			this.output.set(this.footer.subarray(0, footerBytes), rows * rowBytes);
			pixels = this.output.subarray(0, this.outputRows * rowBytes);
		} else {
			pixels = this.previousPixels!;
			this.outputRows = this.height;
		}
		this.finished = pixels;
		this.previous = null;
		this.previousPixels = null;
		this.footerRows = 0;
		return { pixels, rows: this.outputRows };
	}

	/**
	 * 到目前为止的长图，从上到下的若干段（画布 + 底部栏），供预览用。
	 * 返回的是内部缓冲的子视图，不拷贝像素，下一次 `add` 之后内容会变。
	 */
	segments(): { pixels: Uint8Array; rows: number }[] {
		if (this.finished) return [{ pixels: this.finished, rows: this.outputRows }];
		const rowBytes = this.rowBytes;
		if (!this.begun) {
			if (!this.previous || !this.previousPixels) return [];
			return [{ pixels: this.previousPixels, rows: this.height }];
		}
		const result: { pixels: Uint8Array; rows: number }[] = [];
		const rows = Math.min(this.canvasRows, this.deepestScroll + this.deepestBottom);
		if (rows > 0) result.push({ pixels: this.output.subarray(0, rows * rowBytes), rows });
		if (this.deepestBottom < this.height) {
			const footerRows = this.height - this.deepestBottom;
			result.push({ pixels: this.footer.subarray(0, footerRows * rowBytes), rows: footerRows });
		}
		return result;
	}

	// MARK: - 画布

	/** 保证画布至少有 `bytes` 字节容量，不够时倍增扩容（不一次按 maxHeight 预分配）。 */
	private ensureCanvas(bytes: number): void {
		if (this.output.length >= bytes) return;
		let capacity = Math.max(this.output.length, this.rowBytes * Math.min(this.maxHeight, this.height * 4));
		while (capacity < bytes) capacity *= 2;
		capacity = Math.min(capacity, this.rowBytes * this.maxHeight + this.rowBytes * this.height);
		if (capacity < bytes) capacity = bytes;
		const grown = new Uint8Array(capacity);
		grown.set(this.output.subarray(0, this.canvasRows * this.rowBytes));
		this.output = grown;
	}

	/** 开始之前，最新的一帧就是起点。 */
	private follow(frame: Analysis, pixels: Uint8Array, bytesPerRow: number): void {
		this.previous = frame;
		this.previousScroll = 0;
		const rowBytes = this.rowBytes;
		if (!this.previousPixels || this.previousPixels.length !== rowBytes * this.height) {
			this.previousPixels = new Uint8Array(rowBytes * this.height);
		}
		const target = this.previousPixels;
		for (let y = 0; y < this.height; y++) {
			const source = y * bytesPerRow;
			target.set(pixels.subarray(source, source + rowBytes), y * rowBytes);
		}
	}

	/** 上一帧成为长图的顶部。 */
	private begin(top: number, bottom: number): void {
		const rowBytes = this.rowBytes;
		const previousPixels = this.previousPixels!;
		this.begun = true;
		this.headerRows = top;
		this.ensureCanvas(bottom * rowBytes);
		this.output.set(previousPixels.subarray(0, bottom * rowBytes));
		this.canvasRows = bottom;
		this.deepestScroll = 0;
		this.deepestBottom = bottom;
		this.footerRows = this.height - bottom;
		this.footer.set(previousPixels.subarray(bottom * rowBytes));
		this.previousScroll = 0;
		this.previousPixels = null;
	}

	/**
	 * 把这一帧显示的行画到画布上。滚动时固定栏下面最上方的六分之一不画：
	 * 页面滚动后才吸顶的栏，否则会出现在长图中间。
	 */
	private paint(
		frame: Uint8Array,
		bytesPerRow: number,
		scroll: number,
		top: number,
		bottom: number,
		moved: boolean,
		still: Uint8Array,
	): void {
		const rowBytes = this.rowBytes;
		const headerRows = this.headerRows;
		const floor = Math.max(top, headerRows);
		let from = moved ? Math.max(floor, headerRows + Math.trunc((this.height - headerRows) / 6)) : floor;
		from = Math.max(moved ? floor : headerRows, Math.min(from, this.canvasRows - scroll));
		from = Math.max(from, headerRows - scroll);
		if (bottom > from) {
			const existing = this.canvasRows;
			const end = scroll + bottom;
			if (end > this.canvasRows) {
				this.ensureCanvas(end * rowBytes);
				this.output.fill(0, this.canvasRows * rowBytes, end * rowBytes);
				this.canvasRows = end;
			}
			// 长图里已有的行，保留右侧浮动滚动条时隐时现的那一条，以及其余部分在滚、自己不动的列
			// （吸顶侧栏）：重画它们会把它们拖成一长条。spans 是按字节算的 [start, count]，相邻的合并。
			const columns = this.columns;
			const segmentWidth = this.segmentWidth;
			const spans: { start: number; count: number }[] = [];
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (still[segment]) continue;
				const start = Math.min(columns, segment * segmentWidth) * 4;
				const stop = (segment === SEGMENTS - 1 ? columns : Math.min(columns, (segment + 1) * segmentWidth)) * 4;
				if (stop <= start) continue;
				const last = spans[spans.length - 1];
				if (last && last.start + last.count === start) {
					last.count += stop - start;
				} else {
					spans.push({ start, count: stop - start });
				}
			}
			// 新的行里这种列填成它的背景色，吸顶侧栏就像整页截图那样只在顶部出现一次。
			const fills: { start: number; count: number; pixel: Uint8Array }[] = [];
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (!still[segment]) continue;
				const start = Math.min(columns, segment * segmentWidth);
				const stop = segment === SEGMENTS - 1 ? columns : Math.min(columns, (segment + 1) * segmentWidth);
				if (stop <= start) continue;
				fills.push({
					start,
					count: stop - start,
					pixel: this.commonPixel(frame, bytesPerRow, start, stop, top, bottom),
				});
			}
			const canvas = this.output;
			for (let y = from; y < bottom; y++) {
				const target = (scroll + y) * rowBytes;
				const source = y * bytesPerRow;
				if (scroll + y >= existing) {
					canvas.set(frame.subarray(source, source + rowBytes), target);
					for (const fill of fills) fillPixels(canvas, target + fill.start * 4, fill.count, fill.pixel);
				} else {
					for (const span of spans) {
						canvas.set(frame.subarray(source + span.start, source + span.start + span.count), target + span.start);
					}
				}
			}
		}
		if (scroll >= this.deepestScroll) {
			this.deepestScroll = scroll;
			this.deepestBottom = bottom;
			this.footerRows = this.height - bottom;
			for (let y = bottom; y < this.height; y++) {
				const source = y * bytesPerRow;
				this.footer.set(frame.subarray(source, source + rowBytes), (y - bottom) * rowBytes);
			}
		}
	}

	// MARK: - 匹配

	/** 算出每行亮度、行哈希、列段哈希与细节标记、亮度轮廓。 */
	private analyze(frame: Uint8Array, bytesPerRow: number): Analysis {
		const columns = this.columns;
		const height = this.height;
		const segmentWidth = this.segmentWidth;
		const luma = new Uint8Array(columns * height);
		const hashesA = new Uint32Array(height);
		const hashesB = new Uint32Array(height);
		const detailed = new Uint8Array(height);
		const segmentDetailed = new Uint8Array(height * SEGMENTS);
		const segmentHashesA = new Uint32Array(height * SEGMENTS);
		const segmentHashesB = new Uint32Array(height * SEGMENTS);
		const profile = new Int32Array(height * PROFILE_BANDS);
		for (let y = 0; y < height; y++) {
			const rowStart = y * bytesPerRow;
			const lumaStart = y * columns;
			let rowHashA = FNV_BASIS_A;
			let rowHashB = FNV_BASIS_B;
			let rowLow = 255;
			let rowHigh = 0;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				const start = Math.min(columns, segment * segmentWidth);
				const end = segment === SEGMENTS - 1 ? columns : Math.min(columns, start + segmentWidth);
				let sum = 0;
				let hashA = (FNV_BASIS_A + segment) | 0;
				let hashB = (FNV_BASIS_B + segment) | 0;
				let low = 255;
				let high = 0;
				let p = rowStart + start * 4;
				for (let x = start; x < end; x++, p += 4) {
					// BGRA：pixel[2] 是红、pixel[1] 是绿、pixel[0] 是蓝。
					const value = (frame[p + 2] * 77 + frame[p + 1] * 150 + frame[p] * 29) >> 8;
					luma[lumaStart + x] = value;
					hashA = Math.imul(hashA ^ value, FNV_PRIME_A);
					hashB = Math.imul(hashB ^ (value * 0x01010101), FNV_PRIME_B);
					if (value < low) low = value;
					if (value > high) high = value;
					sum += value;
				}
				const index = y * SEGMENTS + segment;
				segmentDetailed[index] = end > start && high - low > TOLERANCE ? 1 : 0;
				segmentHashesA[index] = hashA;
				segmentHashesB[index] = hashB;
				rowHashA = Math.imul(rowHashA ^ hashA, FNV_PRIME_A);
				rowHashB = Math.imul(rowHashB ^ hashB, FNV_PRIME_B);
				profile[y * PROFILE_BANDS + ((segment * PROFILE_BANDS) / SEGMENTS | 0)] += sum;
				if (low < rowLow) rowLow = low;
				if (high > rowHigh) rowHigh = high;
			}
			hashesA[y] = rowHashA;
			hashesB[y] = rowHashB;
			detailed[y] = rowHigh - rowLow > TOLERANCE ? 1 : 0;
		}
		return { luma, hashesA, hashesB, detailed, segmentDetailed, segmentHashesA, segmentHashesB, profile };
	}

	/**
	 * 两行里的某个列段看起来是否一样：像素几乎相同（容许抗锯齿和光标边缘），
	 * 或者形状相同只是深浅不同，比如页面滚动时文字逐渐显现。
	 */
	private segmentMatches(
		a: Analysis,
		rowA: number,
		b: Analysis,
		rowB: number,
		segment: number,
		sameShadeOnly = false,
	): boolean {
		const columns = this.columns;
		const segmentWidth = this.segmentWidth;
		const start = Math.min(columns, segment * segmentWidth);
		const end = segment === SEGMENTS - 1 ? columns : Math.min(columns, start + segmentWidth);
		const allowed = Math.trunc((end - start) / 25) + 1;
		const lumaA = a.luma;
		const lumaB = b.luma;
		const first = rowA * columns;
		const second = rowB * columns;
		let differing = 0;
		for (let x = start; x < end; x++) {
			const difference = lumaA[first + x] - lumaB[second + x];
			if (difference > TOLERANCE || difference < -TOLERANCE) {
				differing += 1;
				if (differing > allowed) break;
			}
		}
		if (differing <= allowed) return true;
		if (sameShadeOnly) return false;
		// 归一化相关不受亮度、对比度变化的影响。
		let sumA = 0;
		let sumB = 0;
		let squaresA = 0;
		let squaresB = 0;
		let products = 0;
		for (let x = start; x < end; x++) {
			const p = lumaA[first + x];
			const q = lumaB[second + x];
			sumA += p;
			sumB += q;
			squaresA += p * p;
			squaresB += q * q;
			products += p * q;
		}
		const n = end - start;
		const varianceA = n * squaresA - sumA * sumA;
		const varianceB = n * squaresB - sumB * sumB;
		const covariance = n * products - sumA * sumB;
		// 两边都要有真正的结构：至少横跨这个列段有一条淡淡的边。
		const floor = n * n * 40;
		if (!(varianceA > floor && varianceB > floor && covariance > 0)) return false;
		return covariance * covariance >= 0.85 * varianceA * varianceB;
	}

	/** 某一行在两帧之间是否没动：完全相同，或者至多一个列段不同（时钟、悬停高亮）。 */
	private rowStays(a: Analysis, b: Analysis, row: number): boolean {
		if (a.hashesA[row] === b.hashesA[row] && a.hashesB[row] === b.hashesB[row]) return true;
		let differing = 0;
		for (let segment = 0; segment < SEGMENTS; segment++) {
			if (this.segmentMatches(a, row, b, row, segment, true)) continue;
			differing += 1;
			if (differing > 1) return false;
		}
		return true;
	}

	/** `current` 相对 `previous` 滚了多少行（正数为向下滚；0 表示原地变化），什么都对不上时返回 null。 */
	private findShift(previous: Analysis, current: Analysis, top: number, bottom: number): number | null {
		const band = bottom - top;
		// 只剩十分之一的重叠也足够匹配了。
		const maxShift = Math.max(0, band - Math.max(24, Math.trunc(band / 10)));
		const votes = this.segmentVotes(previous, current, top, bottom, maxShift);
		const stillVotes = votes[maxShift];
		const ranked: { shift: number; votes: number }[] = [];
		for (let index = 0; index < votes.length; index++) {
			if (votes[index] >= 2 && index !== maxShift) ranked.push({ shift: index - maxShift, votes: votes[index] });
		}
		ranked.sort((a, b) => b.votes - a.votes);

		// 压倒性的精确证据直接定案，即使中间很多地方在变（图片加载、悬停从一张卡片移到另一张）。
		const leader = ranked[0];
		if (leader) {
			const runnerUp = ranked.slice(1).find((entry) => Math.abs(entry.shift - leader.shift) > 2)?.votes ?? 0;
			// 不动的列（吸顶侧栏）在其余部分滚动时会投“没动”的票，所以只要压过“没动”的一半。
			if (leader.votes >= CONVINCING_VOTES && leader.votes >= 2 * runnerUp && 2 * leader.votes >= stillVotes) {
				const settled = this.score(previous, current, leader.shift, top, bottom, 0.15);
				if (settled !== null) {
					this.trace?.(
						`  votes settle ${leader.shift} (${leader.votes} vs still ${stillVotes}, next ${runnerUp}) score ${settled.toFixed(2)}`,
					);
					return leader.shift;
				}
			}
		}
		if (stillVotes >= CONVINCING_VOTES && stillVotes >= 2 * (leader?.votes ?? 0)) {
			this.trace?.(`  votes settle still (${stillVotes} vs ${leader?.votes ?? 0})`);
			return 0;
		}

		const candidates = ranked.slice(0, 3).map((entry) => entry.shift);
		if (maxShift >= 1) {
			candidates.push(...this.profileShifts(previous, current, top, bottom, maxShift));
			if (this.lastShift !== 0 && Math.abs(this.lastShift) <= maxShift) candidates.push(this.lastShift);
		}
		let moving: { shift: number; score: number; votes: number } | null = null;
		const tried = new Set<number>();
		for (const shift of candidates) {
			if (tried.has(shift)) continue;
			tried.add(shift);
			const count = votes[shift + maxShift];
			const value = this.score(previous, current, shift, top, bottom, MINIMUM_SCORE);
			this.trace?.(`  candidate ${shift} votes ${count} score ${value === null ? "-" : value.toFixed(2)}`);
			if (value === null || value < MINIMUM_SCORE) continue;
			if (moving) {
				// 得分明显更高的胜出；否则看证据多少，再看和用户原来的滚动速度是否接近。
				if (value < moving.score - 0.02) continue;
				if (value <= moving.score + 0.02) {
					if (count < moving.votes) continue;
					if (count === moving.votes && Math.abs(shift - this.lastShift) >= Math.abs(moving.shift - this.lastShift)) {
						continue;
					}
				}
			}
			moving = { shift, score: value, votes: count };
		}

		// 原地变化（视频在播放、图片在加载）：中间大部分仍对得上原来的位置，或者整帧大部分没动。
		const bandStill = this.score(previous, current, 0, top, bottom) ?? 0;
		const frameStill =
			bandStill >= MINIMUM_SCORE ? bandStill : (this.score(previous, current, 0, 0, this.height, 0.7) ?? 0);
		const still = bandStill >= MINIMUM_SCORE || frameStill >= 0.7;
		this.trace?.(`  still band ${bandStill.toFixed(2)} frame ${frameStill.toFixed(2)} votes ${stillVotes}`);

		if (moving && (!still || moving.votes > stillVotes || moving.score > bandStill + 0.05)) return moving.shift;
		if (still) return 0;

		// 滚动的同时中间很大一块变了（图片滚进视野时才加载）：没有哪个位移对得很好，
		// 但可能有一个比其他的好得多。
		const scored: { shift: number; score: number }[] = [];
		for (const shift of tried) {
			const value = this.score(previous, current, shift, top, bottom);
			if (value !== null) scored.push({ shift, score: value });
		}
		scored.sort((a, b) => b.score - a.score);
		const best = scored[0];
		const leading = best ? `${best.shift}@${best.score.toFixed(2)}` : "none";
		const leadingVotes = best ? votes[best.shift + maxShift] : 0;
		const next = scored[1] ? scored[1].score.toFixed(2) : "-";
		this.attempt = `max ${maxShift} best ${leading}/${leadingVotes}v next ${next} still ${bandStill.toFixed(2)}`;
		if (!best || best.score < 0.3 || best.score < bandStill + 0.15) return null;
		const second = scored.slice(1).find((entry) => Math.abs(entry.shift - best.shift) > 2)?.score ?? 0;
		this.trace?.(`  relative ${best.shift} score ${best.score.toFixed(2)} next ${second.toFixed(2)}`);
		// 连续丢了几帧之后，上一帧多半已经过期（页面彻底变了），领先得少一点也可以找回来。
		const lead = this.lostStreak >= 3 ? 1.3 : 2;
		if (best.score >= 0.35 || this.lostStreak >= 3) return best.score >= lead * second ? best.shift : null;
		return null;
	}

	/** 帧里某一块最常见的像素，稀疏采样。返回 4 个字节（BGRA）。 */
	private commonPixel(
		frame: Uint8Array,
		bytesPerRow: number,
		fromColumn: number,
		toColumn: number,
		fromRow: number,
		toRow: number,
	): Uint8Array {
		const counts = new Map<number, number>();
		const scratch8 = this.scratch8;
		const scratch32 = this.scratch32;
		// 对齐时用 32 位视图整像素读；不对齐就退回逐字节读，经 scratch 拼成同样的 32 位值。
		const aligned = frame.byteOffset % 4 === 0 && bytesPerRow % 4 === 0;
		const words = aligned ? new Uint32Array(frame.buffer, frame.byteOffset, frame.byteLength >>> 2) : null;
		for (let y = fromRow; y < toRow; y += 4) {
			if (words) {
				const row = (y * bytesPerRow) >>> 2;
				for (let x = fromColumn; x < toColumn; x += 4) {
					const key = words[row + x];
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			} else {
				for (let x = fromColumn; x < toColumn; x += 4) {
					const p = y * bytesPerRow + x * 4;
					scratch8[0] = frame[p];
					scratch8[1] = frame[p + 1];
					scratch8[2] = frame[p + 2];
					scratch8[3] = frame[p + 3];
					const key = scratch32[0];
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			}
		}
		let best = 0xffffffff;
		let bestCount = 0;
		for (const [key, count] of counts) {
			if (count > bestCount) {
				best = key;
				bestCount = count;
			}
		}
		scratch32[0] = best;
		return scratch8.slice();
	}

	/** 中间部分滚了 `shift` 行时，完全留在原地的列段，比如吸顶侧栏。 */
	private stillSegments(previous: Analysis, current: Analysis, shift: number, top: number, bottom: number): Uint8Array {
		const stayed = new Int32Array(SEGMENTS);
		const moved = new Int32Array(SEGMENTS);
		const { segmentDetailed, segmentHashesA: currentA, segmentHashesB: currentB } = current;
		const { segmentHashesA: previousA, segmentHashesB: previousB } = previous;
		for (let y = top; y < bottom; y += 2) {
			const row = y + shift;
			const base = y * SEGMENTS;
			const shifted = row * SEGMENTS;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (!segmentDetailed[base + segment]) continue;
				const hashA = currentA[base + segment];
				const hashB = currentB[base + segment];
				if (previousA[base + segment] === hashA && previousB[base + segment] === hashB) stayed[segment] += 1;
				if (row >= top && row < bottom && previousA[shifted + segment] === hashA && previousB[shifted + segment] === hashB) {
					moved[segment] += 1;
				}
			}
		}
		const still = new Uint8Array(SEGMENTS);
		for (let segment = 0; segment < SEGMENTS; segment++) {
			still[segment] = stayed[segment] >= 6 && stayed[segment] > 2 * moved[segment] ? 1 : 0;
		}
		// 夹在两个不动列段之间的纯色段属于同一列。
		for (let segment = 1; segment < SEGMENTS - 1; segment++) {
			if (still[segment - 1] && still[segment + 1]) still[segment] = 1;
		}
		// 所有列都不动，说明是页面没滚。
		let all = true;
		for (let segment = 0; segment < SEGMENTS; segment++) {
			if (!still[segment]) {
				all = false;
				break;
			}
		}
		return all ? new Uint8Array(SEGMENTS) : still;
	}

	/** 精确匹配的列段给它们之间的位移投票，包括 0。只有带细节、在中间部分里至多出现几次的列段参与。 */
	private segmentVotes(previous: Analysis, current: Analysis, top: number, bottom: number, maxShift: number): Int32Array {
		const stillColumns = this.stillColumns;
		const rowsByHash = new Map<number, number[]>();
		for (let y = top; y < bottom; y++) {
			const base = y * SEGMENTS;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (!previous.segmentDetailed[base + segment] || stillColumns[segment]) continue;
				const key = hashKey(previous.segmentHashesA[base + segment], previous.segmentHashesB[base + segment]);
				const rows = rowsByHash.get(key);
				if (rows) rows.push(y);
				else rowsByHash.set(key, [y]);
			}
		}
		const votes = new Int32Array(2 * maxShift + 1);
		for (let y = top; y < bottom; y++) {
			const base = y * SEGMENTS;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (!current.segmentDetailed[base + segment] || stillColumns[segment]) continue;
				const rows = rowsByHash.get(hashKey(current.segmentHashesA[base + segment], current.segmentHashesB[base + segment]));
				if (!rows || rows.length > 3) continue;
				for (const row of rows) {
					const shift = row - y;
					if (shift >= -maxShift && shift <= maxShift) votes[shift + maxShift] += 1;
				}
			}
		}
		return votes;
	}

	/** 给从不出现完全相同的行的内容（缩放过或重新渲染的文字）用：粗略的行轮廓最吻合的几个位移。 */
	private profileShifts(previous: Analysis, current: Analysis, top: number, bottom: number, maxShift: number): number[] {
		const bands = PROFILE_BANDS;
		const costs = new Float64Array(2 * maxShift + 1).fill(Number.POSITIVE_INFINITY);
		const first = previous.profile;
		const second = current.profile;
		for (let shift = -maxShift; shift <= maxShift; shift++) {
			if (shift === 0) continue;
			const from = Math.max(top, top - shift);
			const to = Math.min(bottom, bottom - shift);
			let total = 0;
			let rows = 0;
			for (let y = from; y < to; y += 2) {
				const a = (y + shift) * bands;
				const b = y * bands;
				for (let band = 0; band < bands; band++) total += Math.abs(first[a + band] - second[b + band]);
				rows += 1;
			}
			if (rows > 0) costs[shift + maxShift] = total / rows;
		}
		const minima: { shift: number; cost: number }[] = [];
		for (let index = 0; index < costs.length; index++) {
			const cost = costs[index];
			if (!Number.isFinite(cost)) continue;
			const left = index > 0 ? costs[index - 1] : Number.POSITIVE_INFINITY;
			const right = index + 1 < costs.length ? costs[index + 1] : Number.POSITIVE_INFINITY;
			if (cost <= left && cost <= right) minima.push({ shift: index - maxShift, cost });
		}
		minima.sort((a, b) => a.cost - b.cost);
		return minima.slice(0, 3).map((entry) => entry.shift);
	}

	/**
	 * `from..<to` 行里（隔行取样）有细节的列段在位移 `shift` 下对得上的比例；
	 * 有细节的太少、判断不了时返回 null。比例已经不可能达到 `need` 时提前放弃，返回 null。
	 */
	private score(previous: Analysis, current: Analysis, shift: number, from: number, to: number, need = 0): number | null {
		const low = Math.max(from, from - shift);
		const high = Math.min(to, to - shift);
		if (high <= low) return null;
		const stillColumns = this.stillColumns;
		const currentDetailed = current.segmentDetailed;
		const previousDetailed = previous.segmentDetailed;
		let total = 0;
		for (let y = low; y < high; y += 2) {
			const base = y * SEGMENTS;
			const shifted = (y + shift) * SEGMENTS;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (!stillColumns[segment] && (currentDetailed[base + segment] || previousDetailed[shifted + segment])) total += 1;
			}
		}
		if (total < 24) return null;
		const allowedMisses = need > 0 ? Math.trunc(total * (1 - need)) : total;
		let misses = 0;
		for (let y = low; y < high; y += 2) {
			const row = y + shift;
			if (previous.hashesA[row] === current.hashesA[y] && previous.hashesB[row] === current.hashesB[y]) continue;
			const base = y * SEGMENTS;
			const shifted = row * SEGMENTS;
			for (let segment = 0; segment < SEGMENTS; segment++) {
				if (stillColumns[segment] || !(currentDetailed[base + segment] || previousDetailed[shifted + segment])) continue;
				if (!this.segmentMatches(previous, row, current, y, segment)) {
					misses += 1;
					if (misses > allowedMisses) return null;
				}
			}
		}
		return (total - misses) / total;
	}
}
