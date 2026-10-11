import { arrowHeadLength, normalizeBox, type Box } from "./geometry";
import { contrastColor, withAlpha } from "./presets";
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, textFont, textPadding } from "./textLayout";
import type {
	Annotation,
	BoxAnnotation,
	CounterAnnotation,
	LineAnnotation,
	PathAnnotation,
	Point,
	RedactAnnotation,
	TextAnnotation,
} from "./types";

/** 马赛克 / 模糊的结果缓存：拖动、缩放画布时不必每帧重新计算。 */
export class RedactCache {
	private entries = new Map<string, HTMLCanvasElement>();

	constructor(private readonly limit = 48) {}

	get(key: string, create: () => HTMLCanvasElement): HTMLCanvasElement {
		const cached = this.entries.get(key);
		if (cached) return cached;
		const created = create();
		if (this.entries.size >= this.limit) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
		this.entries.set(key, created);
		return created;
	}
}

export interface RenderOptions {
	/** 拼接、裁剪后的源图；打码只读取它的像素，不会把其他标注也打进去。 */
	source: HTMLCanvasElement;
	/** 源图内容的标识，内容变化（拼接、裁剪）时缓存随之失效。 */
	sourceKey: string;
	/** 每个图片像素对应多少设备像素：canvas 的阴影模糊不受变换影响，需要自己乘上去。 */
	pixelScale: number;
	cache: RedactCache;
}

function applyShadow(ctx: CanvasRenderingContext2D, width: number, pixelScale: number) {
	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = Math.max(2, width * 1.2) * pixelScale;
	ctx.shadowOffsetY = width * 0.3 * pixelScale;
}

function drawBox(ctx: CanvasRenderingContext2D, annotation: BoxAnnotation, options: RenderOptions) {
	const box = normalizeBox(annotation.x, annotation.y, annotation.w, annotation.h);
	const { color, width, fill } = annotation;
	const trace = () => {
		ctx.beginPath();
		if (annotation.kind === "rect") {
			ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(width * 1.5, box.w / 2, box.h / 2));
		} else {
			ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
		}
	};
	trace();
	if (fill === "solid") {
		applyShadow(ctx, width, options.pixelScale);
		ctx.fillStyle = color;
		ctx.fill();
		return;
	}
	if (fill === "soft") {
		ctx.fillStyle = withAlpha(color, 0.2);
		ctx.fill();
	}
	applyShadow(ctx, width, options.pixelScale);
	ctx.lineWidth = width;
	ctx.lineJoin = "round";
	ctx.strokeStyle = color;
	ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, annotation: LineAnnotation, options: RenderOptions) {
	ctx.beginPath();
	ctx.moveTo(annotation.from.x, annotation.from.y);
	ctx.lineTo(annotation.to.x, annotation.to.y);
	applyShadow(ctx, annotation.width, options.pixelScale);
	ctx.lineWidth = annotation.width;
	ctx.lineCap = "round";
	ctx.strokeStyle = annotation.color;
	ctx.stroke();
}

/** 箭头画成一个实心多边形：箭杆从尾部到头部逐渐变粗，尾端是圆头。 */
function drawArrow(ctx: CanvasRenderingContext2D, annotation: LineAnnotation, options: RenderOptions) {
	const { from, to, width, color } = annotation;
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length < 1) return;
	const ux = (to.x - from.x) / length;
	const uy = (to.y - from.y) / length;
	const nx = -uy;
	const ny = ux;
	const head = arrowHeadLength(width, length);
	const headHalf = head * 0.45;
	const tail = width * 0.2;
	const neck = width * 0.5;
	const base = length - head;
	const notch = length - head * 0.82;
	const at = (along: number, across: number): Point => ({
		x: from.x + ux * along + nx * across,
		y: from.y + uy * along + ny * across,
	});

	ctx.beginPath();
	const points = [at(0, tail), at(notch, neck), at(base, headHalf), at(length, 0), at(base, -headHalf), at(notch, -neck), at(0, -tail)];
	ctx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
	// 尾部的半圆：从 -n 方向经过 -u 绕到 +n 方向
	ctx.arc(from.x, from.y, tail, Math.atan2(-ny, -nx), Math.atan2(ny, nx), true);
	ctx.closePath();
	applyShadow(ctx, width, options.pixelScale);
	ctx.fillStyle = color;
	ctx.fill();
	// 同色细描边让尖角圆润一些
	ctx.shadowColor = "transparent";
	ctx.lineJoin = "round";
	ctx.lineWidth = width * 0.25;
	ctx.strokeStyle = color;
	ctx.stroke();
}

/** 用中点二次曲线连接采样点，让手绘线条平滑。 */
function tracePath(ctx: CanvasRenderingContext2D, points: Point[]) {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	if (points.length === 2) {
		ctx.lineTo(points[1].x, points[1].y);
		return;
	}
	for (let i = 1; i < points.length - 1; i++) {
		const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
		ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
	}
	const last = points[points.length - 1];
	ctx.lineTo(last.x, last.y);
}

function drawPath(ctx: CanvasRenderingContext2D, annotation: PathAnnotation, options: RenderOptions) {
	const { points, width, color } = annotation;
	if (points.length === 0) return;
	if (annotation.kind === "highlighter") ctx.globalAlpha = 0.42;
	else applyShadow(ctx, width, options.pixelScale);
	if (points.length === 1) {
		ctx.beginPath();
		ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		return;
	}
	tracePath(ctx, points);
	ctx.lineWidth = width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.strokeStyle = color;
	ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, annotation: TextAnnotation, options: RenderOptions) {
	const { x, y, w, h, size, style, color, text } = annotation;
	const padding = textPadding(size, style);
	const lineHeight = size * TEXT_LINE_HEIGHT;
	const contrast = contrastColor(color);
	if (style === "pill") {
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, Math.min(h / 2, size * 0.6));
		applyShadow(ctx, size * 0.15, options.pixelScale);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.shadowColor = "transparent";
	}
	ctx.font = textFont(size);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	text.split("\n").forEach((line, index) => {
		const lineY = y + padding.y + lineHeight * index + lineHeight / 2;
		const lineX = x + padding.x;
		if (style === "outline") {
			ctx.lineWidth = size * 0.18;
			ctx.lineJoin = "round";
			ctx.strokeStyle = contrast;
			ctx.strokeText(line, lineX, lineY);
			ctx.fillStyle = color;
		} else if (style === "pill") {
			ctx.fillStyle = contrast;
		} else {
			// 普通文字加一点阴影，在复杂背景上也能看清
			ctx.shadowColor = contrast === "#FFFFFF" ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.45)";
			ctx.shadowBlur = size * 0.2 * options.pixelScale;
			ctx.fillStyle = color;
		}
		ctx.fillText(line, lineX, lineY);
	});
}

function drawCounter(ctx: CanvasRenderingContext2D, annotation: CounterAnnotation, options: RenderOptions) {
	const { x, y, size, color, value } = annotation;
	ctx.beginPath();
	ctx.arc(x, y, size, 0, Math.PI * 2);
	applyShadow(ctx, size * 0.3, options.pixelScale);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.shadowColor = "transparent";
	const ring = size * 0.14;
	ctx.beginPath();
	ctx.arc(x, y, size - ring / 2, 0, Math.PI * 2);
	ctx.lineWidth = ring;
	ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
	ctx.stroke();
	const digits = String(value).length;
	const fontSize = size * (digits <= 1 ? 1.1 : digits === 2 ? 0.92 : 0.74);
	ctx.font = `700 ${fontSize}px ${TEXT_FONT_FAMILY}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = contrastColor(color);
	ctx.fillText(String(value), x, y + size * 0.05);
}

/** 打码区域限制在源图范围内并取整。 */
function redactArea(annotation: RedactAnnotation, source: HTMLCanvasElement): Box | null {
	const box = normalizeBox(annotation.x, annotation.y, annotation.w, annotation.h);
	const left = Math.max(0, Math.floor(box.x));
	const top = Math.max(0, Math.floor(box.y));
	const right = Math.min(source.width, Math.ceil(box.x + box.w));
	const bottom = Math.min(source.height, Math.ceil(box.y + box.h));
	if (right - left < 1 || bottom - top < 1) return null;
	return { x: left, y: top, w: right - left, h: bottom - top };
}

function createCanvas(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, width);
	canvas.height = Math.max(1, height);
	return canvas;
}

/** 生成打码后的图块：像素化是先缩小再关闭平滑放大回去；模糊用 canvas 滤镜，并多取一圈边缘避免发暗。 */
function createRedactPatch(source: HTMLCanvasElement, area: Box, annotation: RedactAnnotation): HTMLCanvasElement {
	const patch = createCanvas(area.w, area.h);
	const ctx = patch.getContext("2d")!;
	if (annotation.mode === "pixelate") {
		const block = Math.max(2, Math.round(annotation.strength));
		const columns = Math.ceil(area.w / block);
		const rows = Math.ceil(area.h / block);
		const small = createCanvas(columns, rows);
		const smallCtx = small.getContext("2d")!;
		smallCtx.imageSmoothingQuality = "high";
		smallCtx.drawImage(source, area.x, area.y, columns * block, rows * block, 0, 0, columns, rows);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(small, 0, 0, columns * block, rows * block);
		return patch;
	}
	const radius = Math.max(1, annotation.strength);
	const margin = Math.ceil(radius * 2);
	ctx.drawImage(source, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
	ctx.filter = `blur(${radius}px)`;
	ctx.drawImage(source, area.x - margin, area.y - margin, area.w + margin * 2, area.h + margin * 2, -margin, -margin, area.w + margin * 2, area.h + margin * 2);
	ctx.filter = "none";
	return patch;
}

function drawRedact(ctx: CanvasRenderingContext2D, annotation: RedactAnnotation, options: RenderOptions) {
	const area = redactArea(annotation, options.source);
	if (!area) return;
	const key = `${annotation.mode}:${annotation.strength}:${area.x},${area.y},${area.w},${area.h}:${options.sourceKey}`;
	const patch = options.cache.get(key, () => createRedactPatch(options.source, area, annotation));
	ctx.imageSmoothingEnabled = annotation.mode === "blur";
	ctx.drawImage(patch, area.x, area.y, area.w, area.h);
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation, options: RenderOptions) {
	ctx.save();
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
			drawBox(ctx, annotation, options);
			break;
		case "line":
			drawLine(ctx, annotation, options);
			break;
		case "arrow":
			drawArrow(ctx, annotation, options);
			break;
		case "pen":
		case "highlighter":
			drawPath(ctx, annotation, options);
			break;
		case "text":
			drawText(ctx, annotation, options);
			break;
		case "counter":
			drawCounter(ctx, annotation, options);
			break;
		case "redact":
			drawRedact(ctx, annotation, options);
			break;
	}
	ctx.restore();
}

/** 按列表顺序绘制所有标注（后画的在上面）。屏幕显示和导出共用这一个函数。 */
export function drawAnnotations(ctx: CanvasRenderingContext2D, annotations: readonly Annotation[], options: RenderOptions) {
	for (const annotation of annotations) drawAnnotation(ctx, annotation, options);
}
