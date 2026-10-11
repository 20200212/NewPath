import { getBounds, moveAnnotation } from "./geometry";
import type { Annotation, StitchPiece } from "./types";

export interface Placement {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface StitchLayout {
	width: number;
	height: number;
	placements: Placement[];
}

export const MAX_STITCH_GAP = 64;

/** 纵向拼接：从上到下排列，水平居中，图片之间留 gap 像素。 */
export function stitchLayout(pieces: readonly StitchPiece[], gap: number): StitchLayout {
	const width = Math.max(0, ...pieces.map((piece) => piece.width));
	let y = 0;
	const placements = pieces.map((piece, index) => {
		if (index > 0) y += gap;
		const placement = { id: piece.id, x: Math.round((width - piece.width) / 2), y, width: piece.width, height: piece.height };
		y += piece.height;
		return placement;
	});
	return { width, height: y, placements };
}

/** 标注中心落在哪一张图上；落在间隙里时取垂直距离最近的那张。 */
function placementOf(layout: StitchLayout, x: number, y: number): Placement | null {
	let best: Placement | null = null;
	let bestDistance = Infinity;
	for (const placement of layout.placements) {
		const dy = y < placement.y ? placement.y - y : y > placement.y + placement.height ? y - placement.y - placement.height : 0;
		const dx = x < placement.x ? placement.x - x : x > placement.x + placement.width ? x - placement.x - placement.width : 0;
		const distance = dy * 1e6 + dx;
		if (distance < bestDistance) {
			best = placement;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * 拼接布局变化（调整顺序、删除、改间距、追加）后，让每个标注跟着它所在的那张图移动；
 * 所在的图被删掉时，标注一起删掉。
 */
export function remapAnnotations(annotations: readonly Annotation[], from: StitchLayout, to: StitchLayout): Annotation[] {
	const targets = new Map(to.placements.map((placement) => [placement.id, placement]));
	const result: Annotation[] = [];
	for (const annotation of annotations) {
		const box = getBounds(annotation);
		const source = placementOf(from, box.x + box.w / 2, box.y + box.h / 2);
		const target = source ? targets.get(source.id) : undefined;
		if (!source || !target) continue;
		const dx = target.x - source.x;
		const dy = target.y - source.y;
		result.push(dx || dy ? moveAnnotation(annotation, dx, dy) : annotation);
	}
	return result;
}

/** 把第 index 张往前（delta = -1）或往后（delta = 1）挪一位。 */
export function movePiece(pieces: readonly StitchPiece[], index: number, delta: number): StitchPiece[] {
	const target = index + delta;
	if (index < 0 || index >= pieces.length || target < 0 || target >= pieces.length) return [...pieces];
	const next = [...pieces];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}
