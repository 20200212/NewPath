// ScrollStitcher 的测试：每一帧都从一张已知的长页面上截出来，拼对了就能原样还原这张页面。
// 移植自 native/newpath-capture-agent/tests/main.swift。

import { describe, expect, it } from "vitest";
import { ScrollStitcher, type StitchOutcome } from "./scrollStitcher";

/** 固定种子的 xorshift32，保证每次运行生成同样的页面。 */
class Random {
	constructor(private state: number) {
		if (this.state === 0) this.state = 0x9e3779b9;
	}

	next(bound: number): number {
		let s = this.state;
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		this.state = s;
		return s % bound;
	}
}

/** BGRA 位图，每行 width * 4 字节。 */
class Bitmap {
	pixels: Uint8Array;

	constructor(
		readonly width: number,
		public height: number,
		gray = 255,
	) {
		this.pixels = new Uint8Array(width * height * 4).fill(gray);
	}

	/** 像文字的墨迹：边长 `cell` 的随机小点，每一行都和相邻的行不同，就像穿过真实文字的一行行像素。 */
	ink(x: number, y: number, w: number, h: number, shade: number, cell: number, random: Random): void {
		for (let top = y; top < y + h; top += cell) {
			for (let left = x; left < x + w; left += cell) {
				if (random.next(100) < 45) this.fill(left, top, cell, Math.min(cell, y + h - top), shade, shade, shade);
			}
		}
	}

	fill(x: number, y: number, w: number, h: number, b: number, g: number, r: number): void {
		const rowFrom = Math.max(0, y);
		const rowTo = Math.min(this.height, y + h);
		const columnFrom = Math.max(0, x);
		const columnTo = Math.min(this.width, x + w);
		if (rowFrom >= rowTo || columnFrom >= columnTo) return;
		for (let row = rowFrom; row < rowTo; row++) {
			for (let column = columnFrom; column < columnTo; column++) {
				const index = (row * this.width + column) * 4;
				this.pixels[index] = b;
				this.pixels[index + 1] = g;
				this.pixels[index + 2] = r;
				this.pixels[index + 3] = 255;
			}
		}
	}

	/** `from..<to` 行的像素子视图。 */
	rows(from: number, to: number): Uint8Array {
		return this.pixels.subarray(from * this.width * 4, to * this.width * 4);
	}

	clone(): Bitmap {
		const copy = new Bitmap(this.width, this.height);
		copy.pixels = this.pixels.slice();
		return copy;
	}

	/** 用另一段像素替换内容，高度随之改变。 */
	withPixels(slice: Uint8Array): Bitmap {
		const copy = new Bitmap(this.width, 0);
		copy.pixels = slice.slice();
		copy.height = slice.length / (this.width * 4);
		return copy;
	}
}

/** 把若干段像素接起来。 */
function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** 类似网页的长页面：彩色标题栏，一行行“文字”、标题、图片，可选一段很长的空白，最后是底部栏。 */
function makePage(width: number, height: number, seed = 7, blankGap = 0): Bitmap {
	const page = new Bitmap(width, height);
	const random = new Random(seed);
	page.fill(0, 0, width, 52, 160, 90, 40);
	page.fill(16, 18, 120, 16, 255, 255, 255);
	let y = 70;
	let gapPlaced = blankGap === 0;
	while (y < height - 60) {
		if (!gapPlaced && y > height / 2) {
			y += blankGap;
			gapPlaced = true;
			continue;
		}
		switch (random.next(10)) {
			case 0: {
				// 图片
				const tall = 80 + random.next(120);
				page.fill(24 + random.next(80), y, Math.trunc(width / 2), tall, random.next(200), random.next(200), random.next(200));
				y += tall + 18;
				break;
			}
			case 1: {
				// 标题
				let x = 24;
				while (x < width / 2) {
					const word = 20 + random.next(70);
					page.ink(x, y, word, 22, 30, 3, random);
					x += word + 14;
				}
				y += 40;
				break;
			}
			default: {
				// 一行文字
				let x = 24;
				const end = width - 40 - random.next(Math.trunc(width / 3));
				while (x < end) {
					const word = 8 + random.next(60);
					const shade = 40 + random.next(60);
					page.ink(x, y + random.next(3), word, 12, shade, 2, random);
					x += word + 7;
				}
				y += 24;
			}
		}
	}
	page.fill(0, height - 44, width, 44, 70, 70, 70);
	page.fill(24, height - 30, 200, 14, 210, 210, 210);
	return page;
}

/** 页面滚动到 `scroll` 时屏幕上看到的样子：开头 `header` 行和最后 `footer` 行不动，其余跟着滚。 */
function frame(page: Bitmap, height: number, header: number, footer: number, scroll: number): Bitmap {
	const shot = new Bitmap(page.width, height);
	const rowBytes = page.width * 4;
	const copy = (sourceRow: number, targetRow: number, count: number) => {
		if (count <= 0) return;
		shot.pixels.set(page.pixels.subarray(sourceRow * rowBytes, (sourceRow + count) * rowBytes), targetRow * rowBytes);
	};
	copy(0, 0, header);
	copy(header + scroll, header, height - header - footer);
	copy(page.height - footer, height - footer, footer);
	return shot;
}

function maxScroll(page: Bitmap, height: number): number {
	return page.height - height;
}

class Run {
	readonly stitcher: ScrollStitcher;
	readonly outcomes: StitchOutcome[] = [];

	constructor(width: number, height: number, maxHeight = 100_000, ignoredRight = 0) {
		this.stitcher = new ScrollStitcher({ width, height, maxHeight, ignoredRight });
	}

	add(shot: Bitmap): StitchOutcome {
		const outcome = this.stitcher.add(shot.pixels, shot.width * 4);
		this.outcomes.push(outcome);
		return outcome;
	}

	finish(): Bitmap {
		const result = this.stitcher.finish();
		const image = new Bitmap(this.stitcher.width, result?.rows ?? 0);
		if (result) image.pixels = result.pixels;
		return image;
	}

	has(outcome: StitchOutcome): boolean {
		return this.outcomes.some((entry) => JSON.stringify(entry) === JSON.stringify(outcome));
	}
}

/** 两张图第一处不同的行；只比较从 `left` 到 `columns` 的列。 */
function firstDifference(a: Bitmap, b: Bitmap, columns: number | null = null, left = 0): number | null {
	const compared = (columns ?? a.width) * 4;
	const rows = Math.min(a.height, b.height);
	for (let row = 0; row < rows; row++) {
		const start = row * a.width * 4;
		const first = a.pixels.subarray(start + left * 4, start + compared);
		const second = b.pixels.subarray(start + left * 4, start + compared);
		if (!sameBytes(first, second)) return row;
	}
	return a.height === b.height ? null : rows;
}

function expectSame(result: Bitmap, expected: Bitmap, columns: number | null = null, left = 0): void {
	expect(result.height, "长图高度").toBe(expected.height);
	const row = firstDifference(result, expected, columns, left);
	expect(row, `从第 ${row} 行开始不同`).toBeNull();
}

/** 按 `positions` 依次滚动，把整张页面滚一遍。 */
function stitch(
	page: Bitmap,
	height: number,
	header: number,
	footer: number,
	positions: number[],
	ignoredRight = 0,
): { run: Run; result: Bitmap } {
	const run = new Run(page.width, height, 100_000, ignoredRight);
	for (const position of positions) run.add(frame(page, height, header, footer, position));
	return { run, result: run.finish() };
}

function steps(start: number, end: number, step: number): number[] {
	const values: number[] = [];
	let value = start;
	while (step > 0 ? value < end : value > end) {
		values.push(value);
		value += step;
	}
	values.push(end);
	return values;
}

const width = 640;
const height = 480;

describe("ScrollStitcher", () => {
	it("匀速滚动还原整张页面", () => {
		const page = makePage(width, 3000);
		const { result } = stitch(page, height, 0, 0, steps(0, maxScroll(page, height), 37));
		expectSame(result, page);
	});

	it("固定的顶部栏和底部栏只出现一次", () => {
		const page = makePage(width, 3200, 11);
		const { result } = stitch(page, height, 52, 44, steps(0, maxScroll(page, height), 61));
		expectSame(result, page);
	});

	it("快慢不均、停顿、往回滚再继续", () => {
		const page = makePage(width, 4000, 23);
		const end = maxScroll(page, height);
		let positions = [0, 0, 3, 9, 30, 30, 30, 90, 200, 360];
		positions = positions.concat([300, 220, 150, 220, 300, 400, 410]);
		positions = positions.concat(steps(410, end, 133));
		positions = positions.concat([end, end]);
		const { run, result } = stitch(page, height, 52, 44, positions);
		expectSame(result, page);
		expect(run.has("behind"), "往回滚应报告 behind").toBe(true);
		expect(run.has("unchanged"), "停顿应报告 unchanged").toBe(true);
	});

	it("长段空白不影响拼接", () => {
		const page = makePage(width, 3600, 5, 220);
		const { result } = stitch(page, height, 52, 44, steps(0, maxScroll(page, height), 45));
		expectSame(result, page);
	});

	it("一下滚过头会丢失，滚回来后接上", () => {
		const page = makePage(width, 3000, 31);
		const end = maxScroll(page, height);
		const run = new Run(width, height);
		for (const position of [0, 100, 200, 1200]) run.add(frame(page, height, 52, 44, position));
		expect(run.outcomes[run.outcomes.length - 1], "跳过重叠部分应报告 lost").toBe("lost");
		for (const position of [600, 300, ...steps(300, end, 90)]) run.add(frame(page, height, 52, 44, position));
		expectSame(run.finish(), page);
		expect(run.stitcher.lostEpisodes, "连续丢失算一次").toBe(1);
	});

	it("从开始向下滚的地方开始拼", () => {
		const page = makePage(width, 3000, 41);
		const end = maxScroll(page, height);
		// 先在中间，往上滚到 200，再一路往下
		const positions = [900, 700, 500, 350, 200, ...steps(200, end, 70)];
		const { run, result } = stitch(page, height, 52, 44, positions);
		const expected = new Bitmap(width, page.height - 200);
		expected.pixels = concat([page.rows(0, 52), page.rows(252, page.height)]);
		expectSame(result, expected);
		expect(run.outcomes.slice(0, 5), "开始前都是 waiting").toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
	});

	it("开始滚动前跟着窗口的变化走", () => {
		const page = makePage(width, 2600, 43);
		const run = new Run(width, height);
		// 窗口还没激活：标题栏是灰的，不是彩色的
		const inactive = frame(page, height, 52, 44, 0);
		inactive.fill(0, 0, width, 52, 200, 200, 200);
		run.add(inactive);
		for (const position of steps(0, maxScroll(page, height), 50)) run.add(frame(page, height, 52, 44, position));
		expectSame(run.finish(), page);
	});

	it("忽略右侧浮动滚动条", () => {
		const page = makePage(width, 3000, 53);
		const end = maxScroll(page, height);
		const run = new Run(width, height, 100_000, 20);
		for (const position of steps(0, end, 55)) {
			const shot = frame(page, height, 0, 0, position);
			// 滑块跟着滚动位置移动，滑轨变深
			shot.fill(width - 14, 0, 10, height, 225, 225, 225);
			shot.fill(width - 12, Math.trunc((position * (height - 80)) / Math.max(1, end)), 6, 80, 120, 120, 120);
			run.add(shot);
		}
		expectSame(run.finish(), page, width - 20);
	});

	it("鼠标下的悬停高亮不影响拼接", () => {
		const page = makePage(width, 3000, 61);
		const run = new Run(width, height);
		for (const position of steps(0, maxScroll(page, height), 64)) {
			const shot = frame(page, height, 0, 0, position);
			// 鼠标所在的 y = 200 附近那几行变成浅蓝
			for (let row = 188; row < 212; row++) {
				for (let column = 0; column < width; column++) {
					const index = (row * width + column) * 4;
					shot.pixels[index] = (shot.pixels[index] >> 1) + 120;
				}
			}
			run.add(shot);
		}
		const result = run.finish();
		expect(result.height, "长图高度").toBe(page.height);
		// 每一行保留最后一次看到的样子，所以只剩最后一帧的高亮
		const last = maxScroll(page, height);
		const dirty: number[] = [];
		for (let row = 0; row < result.height; row++) {
			if (!sameBytes(result.rows(row, row + 1), page.rows(row, row + 1))) dirty.push(row);
		}
		const stray = dirty.filter((row) => row < last + 188 || row >= last + 212);
		expect(stray.slice(0, 5), "高亮残留在别处").toEqual([]);
	});

	it("停住时图片加载完成，最终是加载后的样子", () => {
		const page = makePage(width, 3000, 101);
		const run = new Run(width, height);
		const loaded = page.clone();
		// 页面停住时有一张图片加载完成
		loaded.fill(100, 700, 300, 120, 20, 140, 220);
		for (const position of [0, 60, 120, 180]) run.add(frame(page, height, 52, 44, position));
		run.add(frame(loaded, height, 52, 44, 180));
		for (const position of steps(180, maxScroll(page, height), 70)) run.add(frame(loaded, height, 52, 44, position));
		expect(run.has("lost"), `不应丢失：${JSON.stringify(run.outcomes)}`).toBe(false);
		expectSame(run.finish(), loaded);
	});

	it("滚动途中加载的图片以加载后为准", () => {
		const page = makePage(width, 3000, 103);
		const loaded = page.clone();
		loaded.fill(60, 900, 500, 160, 200, 60, 120);
		const run = new Run(width, height);
		for (const position of steps(0, maxScroll(page, height), 50)) {
			// 滚过 700 之前还是占位图
			run.add(frame(position < 700 ? page : loaded, height, 52, 44, position));
		}
		expect(run.has("lost"), "不应丢失").toBe(false);
		expectSame(run.finish(), loaded);
	});

	it("下半部分正在淡入也能跟上", () => {
		const page = makePage(width, 3000, 107);
		const run = new Run(width, height);
		steps(0, maxScroll(page, height), 45).forEach((position, index) => {
			const shot = frame(page, height, 0, 0, position);
			// 每三帧有一帧下半部分还在淡入：字迹更浅
			if (index % 3 === 1) {
				for (let row = height / 2; row < height; row++) {
					for (let column = 0; column < width; column++) {
						const i = (row * width + column) * 4;
						for (let channel = 0; channel < 3; channel++) {
							shot.pixels[i + channel] = 255 - Math.trunc(((255 - shot.pixels[i + channel]) * 6) / 10);
						}
					}
				}
			}
			run.add(shot);
		});
		expect(run.has("lost"), "不应丢失").toBe(false);
		const result = run.finish();
		expect(result.height, "长图高度").toBe(page.height);
	});

	it("整体亮度轻微变化也能对上", () => {
		const page = makePage(width, 2400, 113);
		const run = new Run(width, height);
		steps(0, maxScroll(page, height), 50).forEach((position, index) => {
			const shot = frame(page, height, 0, 0, position);
			// 隔一帧整体亮 3 级，比如显示器亮度、夜览在变
			if (index % 2 === 1) {
				for (let i = 0; i < shot.pixels.length; i += 4) {
					for (let channel = 0; channel < 3; channel++) {
						if (shot.pixels[i + channel] <= 251) shot.pixels[i + channel] += 3;
					}
				}
			}
			run.add(shot);
		});
		expect(run.has("lost"), `不应丢失：${JSON.stringify(run.outcomes)}`).toBe(false);
		expect(run.finish().height, "长图高度").toBe(page.height);
	});

	it("吸顶侧栏只出现一次，下面是空白", () => {
		const page = makePage(width, 3000, 109);
		const run = new Run(width, height);
		const sidebar = new Bitmap(120, height);
		for (let row = 70; row < height - 40; row += 26) sidebar.fill(14, row, 80, 10, 160, 90, 40);
		for (const position of steps(0, maxScroll(page, height), 60)) {
			const shot = frame(page, height, 52, 44, position);
			for (let row = 52; row < height - 44; row++) {
				shot.pixels.set(sidebar.pixels.subarray(row * 120 * 4, (row + 1) * 120 * 4), row * width * 4);
			}
			run.add(shot);
		}
		expect(run.has("lost"), "不应丢失").toBe(false);
		const result = run.finish();
		expect(result.height, "长图高度").toBe(page.height);
		// 第一屏以下很远的地方，侧栏那一列只有背景色
		let marked = 0;
		for (let row = height + 200; row < result.height - height; row++) {
			for (let column = 0; column < 110; column++) {
				if (result.pixels[(row * width + column) * 4] !== 255) marked += 1;
			}
		}
		expect(marked, "侧栏在长图下方重复出现的像素数").toBe(0);
		expectSame(new Bitmap(width, result.height).withPixels(result.pixels), page, null, 120);
	});

	it("达到最大高度就停止", () => {
		const page = makePage(width, 5000, 71);
		const run = new Run(width, height, 2000);
		for (const position of steps(0, maxScroll(page, height), 80)) run.add(frame(page, height, 52, 44, position));
		expect(run.has("full"), "应报告 full").toBe(true);
		expect(run.stitcher.isFull).toBe(true);
		const result = run.finish();
		expect(result.height, "长图高度").toBe(2000);
		const row = firstDifference(result, new Bitmap(width, 1956).withPixels(page.rows(0, 1956)));
		if (row !== null) expect(row, "内容开始不同的行").toBeGreaterThanOrEqual(1956);
	});

	it("一直不动就得到那一帧", () => {
		const page = makePage(width, 2000, 83);
		const still = frame(page, height, 52, 44, 300);
		const { run, result } = stitch(page, height, 52, 44, [300, 300, 300]);
		expectSame(result, still);
		expect(run.outcomes).toEqual(["waiting", "unchanged", "unchanged"]);
		expect(run.stitcher.started).toBe(false);
	});

	it("进度里的高度随滚动增加", () => {
		const page = makePage(width, 2400, 89);
		const run = new Run(width, height);
		expect(run.stitcher.projectedHeight, "没有帧时").toBe(0);
		expect(run.stitcher.segments()).toEqual([]);
		run.add(frame(page, height, 52, 44, 0));
		expect(run.stitcher.projectedHeight, "第一帧").toBe(height);
		const outcome = run.add(frame(page, height, 52, 44, 120));
		expect(outcome).toEqual({ appended: 120 });
		expect(run.stitcher.projectedHeight, "滚了 120 行后").toBe(height + 120);
		expect(run.stitcher.scrollOffset).toBe(120);
		const segments = run.stitcher.segments();
		const pixels = concat(segments.map((segment) => segment.pixels.subarray(0, segment.rows * width * 4)));
		expect(pixels.length / (width * 4), "分段里的行数").toBe(height + 120);
		// 页面开头 height + 120 - 44 行，加上底部栏
		const expected = concat([page.rows(0, height + 120 - 44), page.rows(page.height - 44, page.height)]);
		expect(sameBytes(pixels, expected), "分段内容不对").toBe(true);
	});

	it("一帧都没有时 finish 返回 null，统计为零", () => {
		const stitcher = new ScrollStitcher({ width, height, maxHeight: 10_000 });
		expect(stitcher.finish()).toBeNull();
		expect(stitcher.stats()).toEqual({ frames: 0, lost: 0, losses: 0, longestLoss: 0, notes: [] });
	});

	it("bytesPerRow 大于 width * 4、起点不对齐的帧也能处理", () => {
		const page = makePage(width, 2000, 131);
		const bytesPerRow = width * 4 + 12;
		const stitcher = new ScrollStitcher({ width, height, maxHeight: 10_000 });
		for (const position of steps(0, maxScroll(page, height), 70)) {
			const shot = frame(page, height, 52, 44, position);
			// 每行末尾多 12 字节填充，整块前面再多 1 字节让 byteOffset 不对齐
			const padded = new Uint8Array(1 + bytesPerRow * height);
			for (let y = 0; y < height; y++) padded.set(shot.rows(y, y + 1), 1 + y * bytesPerRow);
			stitcher.add(padded.subarray(1), bytesPerRow);
		}
		const result = stitcher.finish();
		expect(result).not.toBeNull();
		const image = new Bitmap(width, result!.rows);
		image.pixels = result!.pixels;
		expectSame(image, page);
	});

	it("大尺寸帧足够快", () => {
		const large = makePage(1600, 9000, 97);
		const run = new Run(1600, 1800, 100_000, 40);
		const frames = steps(0, maxScroll(large, 1800), 180).map((position) => frame(large, 1800, 52, 44, position));
		const start = performance.now();
		for (const shot of frames) run.add(shot);
		const perFrame = (performance.now() - start) / frames.length;
		console.log(`每帧 1600x1800 用时 ${perFrame.toFixed(1)} ms（${frames.length} 帧）`);
		expect(perFrame, "太慢，跟不上实时截图").toBeLessThan(100);
		expectSame(run.finish(), large, 1560);
	});
});
