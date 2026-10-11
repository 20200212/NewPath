import { HANDLES, type Handle } from "@/lib/selectionGeometry";
import type { Annotation, Point } from "./types";

export { HANDLES, type Handle };

/** 标注的调整手柄：外框的 8 个方向，或线段的两端。 */
export type HandleId = Handle | "start" | "end";

/** 标注用的矩形（源图像素）。 */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 宽高为负时翻转成正向矩形。 */
export function normalizeBox(x: number, y: number, w: number, h: number): Box {
	return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

/** 拖拽两点得到矩形；square 为 true（按住 Shift）时取正方形。 */
export function boxFromPoints(start: Point, end: Point, square = false): Box {
	let dx = end.x - start.x;
	let dy = end.y - start.y;
	if (square) {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		dx = (Math.sign(dx) || 1) * side;
		dy = (Math.sign(dy) || 1) * side;
	}
	return normalizeBox(start.x, start.y, dx, dy);
}

function boundsOfPoints(points: Point[]): Box {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const point of points) {
		left = Math.min(left, point.x);
		top = Math.min(top, point.y);
		right = Math.max(right, point.x);
		bottom = Math.max(bottom, point.y);
	}
	if (!Number.isFinite(left)) return { x: 0, y: 0, w: 0, h: 0 };
	return { x: left, y: top, w: right - left, h: bottom - top };
}

function expand(box: Box, amount: number): Box {
	return { x: box.x - amount, y: box.y - amount, w: box.w + amount * 2, h: box.h + amount * 2 };
}

/** 箭头头部的长度：短箭头按比例缩小，免得只剩一个头。 */
export function arrowHeadLength(width: number, length: number): number {
	return Math.min(length * 0.6, width * 3.5 + 10);
}

/** 几何外框（不含描边粗细）。 */
export function getBounds(annotation: Annotation): Box {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
		case "text":
			return normalizeBox(annotation.x, annotation.y, annotation.w, annotation.h);
		case "arrow":
		case "line":
			return boundsOfPoints([annotation.from, annotation.to]);
		case "pen":
		case "highlighter":
			return boundsOfPoints(annotation.points);
		case "counter":
			return {
				x: annotation.x - annotation.size,
				y: annotation.y - annotation.size,
				w: annotation.size * 2,
				h: annotation.size * 2,
			};
	}
}

/** 画出来实际占据的范围（含描边、箭头头部、序号白圈）。 */
export function getVisualBounds(annotation: Annotation): Box {
	const bounds = getBounds(annotation);
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "line":
		case "pen":
		case "highlighter":
			return expand(bounds, annotation.width / 2);
		case "arrow": {
			const length = Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y);
			return expand(bounds, Math.max(annotation.width / 2, arrowHeadLength(annotation.width, length) * 0.45));
		}
		case "counter":
			return expand(bounds, annotation.size * 0.15);
		case "text":
		case "redact":
			return bounds;
	}
}

export function boxesIntersect(a: Box, b: Box): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inBox(box: Box, point: Point): boolean {
	return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
	return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function distanceToPolyline(point: Point, points: Point[]): number {
	if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
	let best = Infinity;
	for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
	return best;
}

/**
 * 命中结果：stroke 点在描边上；body 点在实心部分上；
 * inside 点在未填充形状的内部——这是"弱命中"，只在选择工具下生效，而且取最小的那个，嵌套的框都能选到。
 */
export type HitPart = "stroke" | "body" | "inside";

export function hitTest(annotation: Annotation, point: Point, tolerance: number): HitPart | null {
	switch (annotation.kind) {
		case "rect": {
			const box = getBounds(annotation);
			const half = annotation.width / 2 + tolerance;
			if (!inBox(expand(box, half), point)) return null;
			const inner = expand(box, -half);
			if (inner.w <= 0 || inner.h <= 0 || !inBox(inner, point)) return "stroke";
			return annotation.fill === "none" ? "inside" : "body";
		}
		case "ellipse": {
			const box = getBounds(annotation);
			const rx = box.w / 2;
			const ry = box.h / 2;
			if (rx <= 0 || ry <= 0) return null;
			const distance = Math.hypot((point.x - box.x - rx) / rx, (point.y - box.y - ry) / ry);
			if (Math.abs(distance - 1) * Math.min(rx, ry) <= annotation.width / 2 + tolerance) return "stroke";
			if (distance < 1) return annotation.fill === "none" ? "inside" : "body";
			return null;
		}
		case "line":
			return distanceToSegment(point, annotation.from, annotation.to) <= annotation.width / 2 + tolerance ? "stroke" : null;
		case "arrow": {
			const { from, to, width } = annotation;
			if (distanceToSegment(point, from, to) <= width / 2 + tolerance) return "stroke";
			const head = arrowHeadLength(width, Math.hypot(to.x - from.x, to.y - from.y));
			return Math.hypot(point.x - to.x, point.y - to.y) <= head * 0.6 + tolerance ? "stroke" : null;
		}
		case "pen":
		case "highlighter":
			return distanceToPolyline(point, annotation.points) <= annotation.width / 2 + tolerance ? "stroke" : null;
		case "text":
		case "redact":
			return inBox(expand(getBounds(annotation), tolerance), point) ? "body" : null;
		case "counter":
			return Math.hypot(point.x - annotation.x, point.y - annotation.y) <= annotation.size + tolerance ? "body" : null;
	}
}

export interface PickOptions {
	/** 是否接受"点在未填充形状内部"的弱命中。 */
	allowInside: boolean;
	filter?: (annotation: Annotation) => boolean;
}

/** 从最上层开始找光标下的标注；没有描边 / 实心命中时，取包含该点的最小的未填充形状。 */
export function pickAnnotation(
	annotations: readonly Annotation[],
	point: Point,
	tolerance: number,
	options: PickOptions,
): Annotation | null {
	let inside: Annotation | null = null;
	let insideArea = Infinity;
	for (let i = annotations.length - 1; i >= 0; i--) {
		const annotation = annotations[i];
		if (options.filter && !options.filter(annotation)) continue;
		const part = hitTest(annotation, point, tolerance);
		if (!part) continue;
		if (part !== "inside") return annotation;
		if (!options.allowInside) continue;
		const box = getBounds(annotation);
		if (box.w * box.h < insideArea) {
			inside = annotation;
			insideArea = box.w * box.h;
		}
	}
	return inside;
}

function boxHandlePoint(box: Box, handle: Handle): Point {
	const x = handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.w : box.x + box.w / 2;
	const y = handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.h : box.y + box.h / 2;
	return { x, y };
}

/** 选中后显示的手柄。文字只有四个角（拖角缩放字号），序号没有手柄。 */
export function getHandles(annotation: Annotation): { id: HandleId; point: Point }[] {
	switch (annotation.kind) {
		case "arrow":
		case "line":
			return [
				{ id: "start", point: annotation.from },
				{ id: "end", point: annotation.to },
			];
		case "counter":
			return [];
		case "text": {
			const box = getBounds(annotation);
			return (["nw", "ne", "se", "sw"] as const).map((id) => ({ id, point: boxHandlePoint(box, id) }));
		}
		default: {
			const box = getBounds(annotation);
			return HANDLES.map((id) => ({ id, point: boxHandlePoint(box, id) }));
		}
	}
}

export function hitHandle(annotation: Annotation, point: Point, radius: number): HandleId | null {
	for (const handle of getHandles(annotation)) {
		if (Math.hypot(point.x - handle.point.x, point.y - handle.point.y) <= radius) return handle.id;
	}
	return null;
}

export function moveAnnotation<T extends Annotation>(annotation: T, dx: number, dy: number): T {
	switch (annotation.kind) {
		case "arrow":
		case "line":
			return {
				...annotation,
				from: { x: annotation.from.x + dx, y: annotation.from.y + dy },
				to: { x: annotation.to.x + dx, y: annotation.to.y + dy },
			};
		case "pen":
		case "highlighter":
			return { ...annotation, points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
		default:
			return { ...annotation, x: annotation.x + dx, y: annotation.y + dy } as T;
	}
}

/** 以 from 为起点，把方向吸附到最近的 45° 倍数（Shift）。 */
export function snap45(from: Point, to: Point): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
	return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** 拖动手柄后的四条边（可能翻转，不归一化）；keepRatio 时角手柄保持原比例，以对角为锚点。 */
function resizeEdges(box: Box, handle: Handle, dx: number, dy: number, keepRatio: boolean) {
	let left = box.x;
	let top = box.y;
	let right = box.x + box.w;
	let bottom = box.y + box.h;
	if (handle.includes("w")) left += dx;
	if (handle.includes("e")) right += dx;
	if (handle.includes("n")) top += dy;
	if (handle.includes("s")) bottom += dy;
	if (keepRatio && handle.length === 2 && box.w > 0 && box.h > 0) {
		const west = handle.includes("w");
		const north = handle.includes("n");
		const anchorX = west ? box.x + box.w : box.x;
		const anchorY = north ? box.y + box.h : box.y;
		const movingX = west ? left : right;
		const movingY = north ? top : bottom;
		const scale = Math.max(Math.abs(movingX - anchorX) / box.w, Math.abs(movingY - anchorY) / box.h);
		const endX = anchorX + (Math.sign(movingX - anchorX) || (west ? -1 : 1)) * box.w * scale;
		const endY = anchorY + (Math.sign(movingY - anchorY) || (north ? -1 : 1)) * box.h * scale;
		if (west) [left, right] = [endX, anchorX];
		else [left, right] = [anchorX, endX];
		if (north) [top, bottom] = [endY, anchorY];
		else [top, bottom] = [anchorY, endY];
	}
	return { left, top, right, bottom };
}

const MIN_TEXT_SIZE = 6;

/** 从 original（拖动开始时的状态）出发，按手柄位移 dx / dy 调整标注。 */
export function resizeAnnotation(
	original: Annotation,
	handle: HandleId,
	dx: number,
	dy: number,
	keepRatio: boolean,
): Annotation {
	switch (original.kind) {
		case "arrow":
		case "line": {
			if (handle !== "start" && handle !== "end") return original;
			const moving = handle === "start" ? original.from : original.to;
			const fixed = handle === "start" ? original.to : original.from;
			let point = { x: moving.x + dx, y: moving.y + dy };
			if (keepRatio) point = snap45(fixed, point);
			return handle === "start" ? { ...original, from: point } : { ...original, to: point };
		}
		case "counter":
			return original;
		case "text": {
			if (handle === "start" || handle === "end" || handle.length !== 2) return original;
			const box = getBounds(original);
			const edges = resizeEdges(box, handle, dx, dy, true);
			const ratio = box.w > 0 ? Math.abs(edges.right - edges.left) / box.w : 1;
			const size = Math.min(original.size * 12, Math.max(MIN_TEXT_SIZE, original.size * ratio));
			const scale = size / original.size;
			const w = original.w * scale;
			const h = original.h * scale;
			const x = handle.includes("w") ? box.x + box.w - w : box.x;
			const y = handle.includes("n") ? box.y + box.h - h : box.y;
			return { ...original, x, y, w, h, size };
		}
		case "pen":
		case "highlighter": {
			if (handle === "start" || handle === "end") return original;
			const box = getBounds(original);
			const edges = resizeEdges(box, handle, dx, dy, keepRatio);
			const map = (value: number, start: number, size: number, newStart: number, newEnd: number) =>
				size === 0 ? value + (newStart - start) : newStart + ((value - start) / size) * (newEnd - newStart);
			return {
				...original,
				points: original.points.map((point) => ({
					x: map(point.x, box.x, box.w, edges.left, edges.right),
					y: map(point.y, box.y, box.h, edges.top, edges.bottom),
				})),
			};
		}
		default: {
			if (handle === "start" || handle === "end") return original;
			const edges = resizeEdges(getBounds(original), handle, dx, dy, keepRatio);
			return { ...original, ...normalizeBox(edges.left, edges.top, edges.right - edges.left, edges.bottom - edges.top) };
		}
	}
}

/** Ramer–Douglas–Peucker 简化画笔路径，去掉几乎共线的点。 */
export function simplifyPath(points: Point[], epsilon: number): Point[] {
	if (points.length <= 2) return points;
	const keep = new Array<boolean>(points.length).fill(false);
	keep[0] = keep[points.length - 1] = true;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [start, end] = stack.pop()!;
		let farthest = -1;
		let maxDistance = epsilon;
		for (let i = start + 1; i < end; i++) {
			const distance = distanceToSegment(points[i], points[start], points[end]);
			if (distance > maxDistance) {
				maxDistance = distance;
				farthest = i;
			}
		}
		if (farthest >= 0) {
			keep[farthest] = true;
			stack.push([start, farthest], [farthest, end]);
		}
	}
	return points.filter((_, index) => keep[index]);
}

/** 太小的标注（误点出来的）直接丢弃。 */
export function isDegenerate(annotation: Annotation): boolean {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
			return annotation.w < 3 || annotation.h < 3;
		case "arrow":
		case "line":
			return Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y) < 4;
		case "pen":
		case "highlighter":
			return annotation.points.length < 2;
		case "text":
			return !annotation.text.trim();
		case "counter":
			return false;
	}
}

/** 下一个序号：现有最大值加一。 */
export function nextCounterValue(annotations: readonly Annotation[]): number {
	let max = 0;
	for (const annotation of annotations) if (annotation.kind === "counter") max = Math.max(max, annotation.value);
	return max + 1;
}
