/**
 * 开发用的滚动夹具：不截屏，而是在一张长图上模拟"滚动"（顶部、底部各有一条不动的栏），
 * 没有真实页面也能把滚动截图的整条链路走一遍。时间线和 macOS 截图进程 ScrollCapture.swift 的 startFixture 一致：
 * 停 0.6 秒，滚到 40%，停一下，往回滚 0.3 屏，再一路滚到底。
 */

export const FIXTURE_INTERVAL_MS = 33;

export interface FixtureKey {
	/** 秒 */
	time: number;
	/** 滚动位置（像素） */
	position: number;
}

/** 关键帧。 */
export function fixtureKeys(pageHeight: number, frameHeight: number): FixtureKey[] {
	const end = Math.max(0, pageHeight - frameHeight);
	const screen = Math.max(1, frameHeight);
	const keys: FixtureKey[] = [
		{ time: 0, position: 0 },
		{ time: 0.6, position: 0 },
	];
	const move = (position: number, screensPerSecond: number) => {
		const last = keys[keys.length - 1];
		keys.push({ time: last.time + Math.abs(position - last.position) / (screen * screensPerSecond), position });
	};
	const middle = end * 0.4;
	move(middle, 1);
	keys.push({ time: keys[keys.length - 1].time + 0.4, position: middle });
	move(Math.max(0, middle - screen * 0.3), 0.8);
	move(end, 1.2);
	return keys;
}

/** 第 time 秒时滚到哪里；超过时间线末尾停在底部。 */
export function fixturePosition(time: number, keys: readonly FixtureKey[], pageHeight: number, frameHeight: number): number {
	const end = Math.max(0, pageHeight - frameHeight);
	const next = keys.findIndex((key) => key.time > time);
	if (next < 0) return Math.round(end);
	const from = keys[Math.max(0, next - 1)];
	const to = keys[next];
	const progress = (time - from.time) / Math.max(0.001, to.time - from.time);
	return Math.max(0, Math.min(end, Math.round(from.position + (to.position - from.position) * progress)));
}

/** 顶部不动的栏占多少行、底部占多少行。 */
export function fixtureBars(frameHeight: number) {
	return { header: Math.floor(frameHeight / 8), footer: Math.floor(frameHeight / 16) };
}

/**
 * 从长页 page（BGRA，宽 width、高 pageHeight）渲染滚动到 scroll 处的一帧到 out（宽 width、高 frameHeight）：
 * 顶部栏来自页面顶部，底部栏来自页面底部，中间按 scroll 偏移。
 */
export function renderFixtureFrame(
	page: Uint8Array,
	width: number,
	pageHeight: number,
	frameHeight: number,
	scroll: number,
	out: Uint8Array,
) {
	const rowBytes = width * 4;
	const { header, footer } = fixtureBars(frameHeight);
	const clamped = Math.max(0, Math.min(pageHeight - frameHeight, scroll));
	out.set(page.subarray(0, header * rowBytes), 0);
	const bodyRows = frameHeight - header - footer;
	out.set(page.subarray((header + clamped) * rowBytes, (header + clamped + bodyRows) * rowBytes), header * rowBytes);
	out.set(page.subarray((pageHeight - footer) * rowBytes, pageHeight * rowBytes), (frameHeight - footer) * rowBytes);
}
