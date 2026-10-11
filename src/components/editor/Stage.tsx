import {
	useEffect,
	useRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type MutableRefObject,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { cropHitAt } from "@/editor/crop";
import {
	boxFromPoints,
	getBounds,
	getHandles,
	getVisualBounds,
	hitHandle,
	isDegenerate,
	moveAnnotation,
	nextCounterValue,
	pickAnnotation,
	resizeAnnotation,
	simplifyPath,
	snap45,
	type HandleId,
} from "@/editor/geometry";
import {
	contrastColor,
	counterRadiusFor,
	redactStrengthFor,
	strokeWidthFor,
	textSizeFor,
} from "@/editor/presets";
import { drawAnnotations, RedactCache } from "@/editor/renderAnnotations";
import { measureText, TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, TEXT_LINE_HEIGHT, textPadding } from "@/editor/textLayout";
import type { Annotation, CounterAnnotation, Point, Rect } from "@/editor/types";
import {
	HANDLES,
	intersectBounds,
	moveRect,
	rectFromPoints,
	resizeRect,
	type Handle,
} from "@/lib/selectionGeometry";
import type { StageProps } from "./stageTypes";

type Drag =
	| { kind: "pan"; last: Point }
	| { kind: "draw"; start: Point; base: Annotation; points: Point[]; straight: boolean }
	| { kind: "move"; start: Point; original: Annotation; moved: boolean; editOnClick: boolean }
	| { kind: "resize"; start: Point; original: Annotation; handle: HandleId }
	| { kind: "counter"; start: Point; original: CounterAnnotation; moved: boolean }
	| { kind: "crop-new"; start: Point; previous: Rect }
	| { kind: "crop-move"; start: Point; origin: Rect }
	| { kind: "crop-resize"; start: Point; origin: Rect; handle: Handle };

const ACCENT = "#007AFF";
/** 命中容差、手柄半径、拖动阈值，单位都是 CSS 像素，使用时除以缩放比例换算成图片像素。 */
const HIT_TOLERANCE = 6;
const HANDLE_HIT_RADIUS = 8;
const HANDLE_RADIUS = 4.5;
const CROP_TOLERANCE = 8;
const MOVE_THRESHOLD = 3;

const HANDLE_CURSORS: Record<Handle, string> = {
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	nw: "nwse-resize",
	se: "nwse-resize",
};

function handleCursor(handle: HandleId): string {
	return handle === "start" || handle === "end" ? "pointer" : HANDLE_CURSORS[handle];
}

let idSeq = 0;
function newId() {
	return `${Date.now().toString(36)}-${++idSeq}`;
}

/** 列表里有同 id 的就替换，没有就追加到最上层。 */
function replaceOrAppend(list: readonly Annotation[], annotation: Annotation): Annotation[] {
	const index = list.findIndex((item) => item.id === annotation.id);
	if (index < 0) return [...list, annotation];
	const next = [...list];
	next[index] = annotation;
	return next;
}

function rectHandlePoint(rect: Rect, handle: Handle): Point {
	const x = handle.includes("w") ? rect.x : handle.includes("e") ? rect.x + rect.width : rect.x + rect.width / 2;
	const y = handle.includes("n") ? rect.y : handle.includes("s") ? rect.y + rect.height : rect.y + rect.height / 2;
	return { x, y };
}

/** 编辑器画布：一块视口大小的 canvas 画出源图、标注和选中框，处理所有指针交互；文字编辑用覆盖在上面的文本框。 */
export function Stage(props: StageProps) {
	const { view, textEdit } = props;
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const propsRef = useRef(props);
	propsRef.current = props;
	const dragRef = useRef<Drag | null>(null);
	/** 拖动中的标注：每帧重绘，松手时才提交到文档。 */
	const liveRef = useRef<Annotation | null>(null);
	const hoverIdRef = useRef<string | null>(null);
	const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const cacheRef = useRef(new RedactCache());
	const frameRef = useRef(0);

	const toScreen = (point: Point): Point => {
		const { origin, scale } = propsRef.current.view;
		return { x: origin.x + point.x * scale, y: origin.y + point.y * scale };
	};

	const draw = () => {
		frameRef.current = 0;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const current = propsRef.current;
		const { viewport, scale, origin } = current.view;
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(viewport.width * dpr));
		const height = Math.max(1, Math.round(viewport.height * dpr));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, width, height);
		const source = current.source;
		if (!source || viewport.width === 0 || viewport.height === 0) return;
		const imageWidth = source.width;
		const imageHeight = source.height;

		// 图片下面的白色卡片阴影
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
		ctx.shadowBlur = 24 * dpr;
		ctx.shadowOffsetY = 6 * dpr;
		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(origin.x, origin.y, imageWidth * scale, imageHeight * scale);
		ctx.restore();

		// 源图和标注：图片像素坐标
		const pixelScale = scale * dpr;
		ctx.setTransform(pixelScale, 0, 0, pixelScale, origin.x * dpr, origin.y * dpr);
		// 放大到 2 倍以上时关闭平滑，像素清晰可见
		ctx.imageSmoothingEnabled = pixelScale < 2;
		ctx.drawImage(source, 0, 0);
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, imageWidth, imageHeight);
		ctx.clip();
		const editingId = current.textEdit?.id ?? null;
		let list = current.annotations.filter((annotation) => annotation.id !== editingId);
		const live = liveRef.current;
		if (live) list = replaceOrAppend(list, live);
		drawAnnotations(ctx, list, { source, sourceKey: current.sourceKey, pixelScale, cache: cacheRef.current });
		ctx.restore();

		// 以下是屏幕坐标（CSS 像素）的辅助图层
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = true;

		if (current.crop) {
			drawCropOverlay(ctx, current.crop, imageWidth, imageHeight);
			return;
		}

		const drag = dragRef.current;
		const hoverId = hoverIdRef.current;
		if (!drag && hoverId && hoverId !== current.selectedId && hoverId !== editingId) {
			const hovered = current.annotations.find((annotation) => annotation.id === hoverId);
			if (hovered) {
				const box = getVisualBounds(hovered);
				const topLeft = toScreen({ x: box.x, y: box.y });
				ctx.save();
				ctx.setLineDash([4, 3]);
				ctx.lineWidth = 1;
				ctx.strokeStyle = "rgba(0, 122, 255, 0.55)";
				ctx.strokeRect(Math.round(topLeft.x) + 0.5, Math.round(topLeft.y) + 0.5, box.w * scale, box.h * scale);
				ctx.restore();
			}
		}

		const selectedId = current.selectedId;
		if (selectedId && selectedId !== editingId) {
			const selected =
				live?.id === selectedId ? live : current.annotations.find((annotation) => annotation.id === selectedId);
			if (selected) drawSelection(ctx, selected);
		}
	};

	const drawSelection = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
		const { scale } = propsRef.current.view;
		ctx.save();
		if (annotation.kind !== "arrow" && annotation.kind !== "line") {
			const box = getBounds(annotation);
			const topLeft = toScreen({ x: box.x, y: box.y });
			ctx.lineWidth = 1;
			ctx.strokeStyle = ACCENT;
			ctx.strokeRect(Math.round(topLeft.x) + 0.5, Math.round(topLeft.y) + 0.5, box.w * scale, box.h * scale);
		}
		ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
		ctx.shadowBlur = 3;
		for (const handle of getHandles(annotation)) {
			const point = toScreen(handle.point);
			ctx.beginPath();
			ctx.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
			ctx.fillStyle = "#FFFFFF";
			ctx.fill();
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = ACCENT;
			ctx.stroke();
		}
		ctx.restore();
	};

	const drawCropOverlay = (ctx: CanvasRenderingContext2D, crop: Rect, imageWidth: number, imageHeight: number) => {
		const { scale } = propsRef.current.view;
		const image = toScreen({ x: 0, y: 0 });
		const topLeft = toScreen({ x: crop.x, y: crop.y });
		const width = crop.width * scale;
		const height = crop.height * scale;
		ctx.save();
		// 框外半透明遮罩（奇偶规则挖掉裁剪框）
		ctx.beginPath();
		ctx.rect(image.x, image.y, imageWidth * scale, imageHeight * scale);
		ctx.rect(topLeft.x, topLeft.y, width, height);
		ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
		ctx.fill("evenodd");
		// 三分线
		ctx.beginPath();
		for (const ratio of [1 / 3, 2 / 3]) {
			ctx.moveTo(topLeft.x + width * ratio, topLeft.y);
			ctx.lineTo(topLeft.x + width * ratio, topLeft.y + height);
			ctx.moveTo(topLeft.x, topLeft.y + height * ratio);
			ctx.lineTo(topLeft.x + width, topLeft.y + height * ratio);
		}
		ctx.lineWidth = 1;
		ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
		ctx.stroke();
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = "#FFFFFF";
		ctx.strokeRect(topLeft.x, topLeft.y, width, height);
		// 8 个方形手柄
		const screenRect = { x: topLeft.x, y: topLeft.y, width, height };
		ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
		ctx.shadowBlur = 3;
		for (const handle of HANDLES) {
			const point = rectHandlePoint(screenRect, handle);
			ctx.fillStyle = "#FFFFFF";
			ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
		}
		ctx.restore();
	};

	const requestDraw = () => {
		if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
	};

	useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

	// ---------------------------------------------------------------- 命中与光标

	const tolerance = () => HIT_TOLERANCE / propsRef.current.view.scale;

	/** 当前工具能否直接抓起这个标注：选择工具任意抓；其他工具只抓同类和已选中的；画笔、荧光笔不抓，方便在标注上继续画。 */
	const canGrab = (annotation: Annotation) => {
		const { tool, selectedId } = propsRef.current;
		if (tool === "pen" || tool === "highlighter") return false;
		return tool === "select" || annotation.kind === tool || annotation.id === selectedId;
	};

	const selectedAnnotation = () => {
		const { annotations, selectedId } = propsRef.current;
		return selectedId ? (annotations.find((annotation) => annotation.id === selectedId) ?? null) : null;
	};

	const pickAt = (point: Point) => {
		const { annotations, tool } = propsRef.current;
		if (tool === "pen" || tool === "highlighter") return null;
		return pickAnnotation(annotations, point, tolerance(), { allowInside: tool === "select", filter: canGrab });
	};

	const updateCursor = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const current = propsRef.current;
		const drag = dragRef.current;
		let cursor = "crosshair";
		let hoverId: string | null = null;
		const pointer = lastPointerRef.current;
		if (drag?.kind === "pan") cursor = "grabbing";
		else if (current.view.handMode || current.view.spaceHeld) cursor = "grab";
		else if (drag) cursor = canvas.style.cursor || "crosshair";
		else if (pointer && current.source) {
			const point = current.view.toImage(pointer.clientX, pointer.clientY);
			if (current.crop) {
				const hit = cropHitAt(current.crop, point, CROP_TOLERANCE / current.view.scale);
				cursor = hit === null ? "crosshair" : hit === "move" ? "move" : HANDLE_CURSORS[hit];
			} else {
				const selected = selectedAnnotation();
				const handle =
					selected && canGrab(selected) ? hitHandle(selected, point, HANDLE_HIT_RADIUS / current.view.scale) : null;
				const hit = handle ? null : pickAt(point);
				if (handle) cursor = handleCursor(handle);
				else if (hit) {
					cursor = "move";
					hoverId = hit.id;
				} else cursor = current.tool === "select" ? "default" : current.tool === "text" ? "text" : "crosshair";
			}
		}
		canvas.style.cursor = cursor;
		if (hoverId !== hoverIdRef.current) {
			hoverIdRef.current = hoverId;
			requestDraw();
		}
	};

	// 每次渲染（文档、视图、选中变化）后重绘，并刷新光标（空格、抓手模式切换时不需要移动鼠标）
	useEffect(() => {
		requestDraw();
		updateCursor();
	});

	// ---------------------------------------------------------------- 指针交互

	const createBase = (point: Point): Annotation | null => {
		const { tool, style, unit } = propsRef.current;
		const id = newId();
		switch (tool) {
			case "rect":
			case "ellipse":
				return { id, kind: tool, x: point.x, y: point.y, w: 0, h: 0, color: style.color, width: strokeWidthFor(tool, style.strokeSize, unit), fill: style.fill };
			case "redact":
				return { id, kind: "redact", x: point.x, y: point.y, w: 0, h: 0, mode: style.redactMode, strength: redactStrengthFor(style.redactMode, style.strokeSize, unit) };
			case "arrow":
			case "line":
				return { id, kind: tool, from: point, to: point, color: style.color, width: strokeWidthFor(tool, style.strokeSize, unit) };
			case "pen":
			case "highlighter":
				return { id, kind: tool, points: [point], color: style.color, width: strokeWidthFor(tool, style.strokeSize, unit) };
			default:
				return null;
		}
	};

	const startTextEdit = (annotation: Annotation) => {
		if (annotation.kind !== "text") return;
		const { onSelect, onStartText } = propsRef.current;
		onSelect(annotation.id);
		onStartText({
			id: annotation.id,
			x: annotation.x,
			y: annotation.y,
			text: annotation.text,
			color: annotation.color,
			size: annotation.size,
			style: annotation.style,
		});
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const current = propsRef.current;
		const { view } = current;
		lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		if (!current.source) return;
		const panning = event.button === 1 || (event.button === 0 && (view.handMode || view.spaceHeld));
		if (event.button === 1) event.preventDefault();
		if (!panning && event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);

		if (panning) {
			dragRef.current = { kind: "pan", last: { x: event.clientX, y: event.clientY } };
			updateCursor();
			return;
		}

		const point = view.toImage(event.clientX, event.clientY);
		const bounds = { width: current.imageSize.width, height: current.imageSize.height };

		if (current.crop) {
			const hit = cropHitAt(current.crop, point, CROP_TOLERANCE / view.scale);
			if (hit === "move") dragRef.current = { kind: "crop-move", start: point, origin: current.crop };
			else if (hit) dragRef.current = { kind: "crop-resize", start: point, origin: current.crop, handle: hit };
			else {
				const start = {
					x: Math.min(Math.max(0, point.x), bounds.width),
					y: Math.min(Math.max(0, point.y), bounds.height),
				};
				dragRef.current = { kind: "crop-new", start, previous: current.crop };
			}
			return;
		}

		// 正在编辑文字时，点画布其他地方只是结束编辑
		if (current.textEdit) {
			current.onTextCommit();
			return;
		}

		const selected = selectedAnnotation();
		if (selected && canGrab(selected)) {
			const handle = hitHandle(selected, point, HANDLE_HIT_RADIUS / view.scale);
			if (handle) {
				dragRef.current = { kind: "resize", start: point, original: selected, handle };
				return;
			}
		}

		const hit = pickAt(point);
		if (hit) {
			const editOnClick = hit.kind === "text" && (current.tool === "text" || hit.id === current.selectedId);
			current.onSelect(hit.id);
			dragRef.current = { kind: "move", start: point, original: hit, moved: false, editOnClick };
			return;
		}

		switch (current.tool) {
			case "select":
				current.onSelect(null);
				return;
			case "text": {
				const { style, unit } = current;
				const size = textSizeFor(style.textSize, unit);
				const padding = textPadding(size, style.textStyle);
				current.onSelect(null);
				current.onStartText({
					id: null,
					x: point.x - padding.x,
					y: point.y - ((size * TEXT_LINE_HEIGHT) / 2 + padding.y),
					text: "",
					color: style.color,
					size,
					style: style.textStyle,
				});
				return;
			}
			case "counter": {
				const counter: CounterAnnotation = {
					id: newId(),
					kind: "counter",
					x: point.x,
					y: point.y,
					value: nextCounterValue(current.annotations),
					color: current.style.color,
					size: counterRadiusFor(current.style.strokeSize, current.unit),
				};
				// 点下就放置；继续拖动可以调整位置，和放置合并成一步撤销
				current.onCommit([...current.annotations, counter], { coalesceKey: `place:${counter.id}`, select: counter.id });
				dragRef.current = { kind: "counter", start: point, original: counter, moved: false };
				return;
			}
			default: {
				const base = createBase(point);
				if (base) dragRef.current = { kind: "draw", start: point, base, points: [point], straight: false };
			}
		}
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		const drag = dragRef.current;
		const current = propsRef.current;
		const { view } = current;
		if (!drag) {
			updateCursor();
			return;
		}
		if (drag.kind === "pan") {
			view.panBy(event.clientX - drag.last.x, event.clientY - drag.last.y);
			drag.last = { x: event.clientX, y: event.clientY };
			return;
		}

		const point = view.toImage(event.clientX, event.clientY);
		const bounds = { width: current.imageSize.width, height: current.imageSize.height };
		let dx = point.x - drag.start.x;
		let dy = point.y - drag.start.y;

		switch (drag.kind) {
			case "crop-new": {
				const end = { x: Math.min(Math.max(0, point.x), bounds.width), y: Math.min(Math.max(0, point.y), bounds.height) };
				current.onCropChange(intersectBounds(rectFromPoints(drag.start, end), bounds));
				return;
			}
			case "crop-move":
				current.onCropChange(moveRect(drag.origin, dx, dy, bounds));
				return;
			case "crop-resize":
				current.onCropChange(resizeRect(drag.origin, drag.handle, dx, dy, bounds));
				return;
			case "draw": {
				const base = drag.base;
				if (base.kind === "rect" || base.kind === "ellipse" || base.kind === "redact") {
					liveRef.current = { ...base, ...boxFromPoints(drag.start, point, event.shiftKey) };
				} else if (base.kind === "arrow" || base.kind === "line") {
					liveRef.current = { ...base, to: event.shiftKey ? snap45(drag.start, point) : point };
				} else if (base.kind === "pen" || base.kind === "highlighter") {
					const minDistance = 1 / view.scale;
					const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
					for (const sample of samples.length ? samples : [event.nativeEvent]) {
						const sampled = view.toImage(sample.clientX, sample.clientY);
						const last = drag.points[drag.points.length - 1];
						if (Math.hypot(sampled.x - last.x, sampled.y - last.y) >= minDistance) drag.points.push(sampled);
					}
					// 按住 Shift 画直线（吸附 45°）
					drag.straight = event.shiftKey;
					liveRef.current = {
						...base,
						points: drag.straight ? [drag.start, snap45(drag.start, point)] : [...drag.points],
					};
				}
				break;
			}
			case "move":
			case "counter": {
				if (!drag.moved && Math.hypot(dx, dy) * view.scale < MOVE_THRESHOLD) return;
				drag.moved = true;
				// Shift 锁定为水平或竖直移动
				if (event.shiftKey) {
					if (Math.abs(dx) > Math.abs(dy)) dy = 0;
					else dx = 0;
				}
				liveRef.current = moveAnnotation(drag.original, dx, dy);
				break;
			}
			case "resize":
				liveRef.current = resizeAnnotation(drag.original, drag.handle, dx, dy, event.shiftKey);
				break;
		}
		requestDraw();
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const drag = dragRef.current;
		dragRef.current = null;
		const live = liveRef.current;
		liveRef.current = null;
		const current = propsRef.current;
		if (!drag) return;

		switch (drag.kind) {
			case "crop-new": {
				// 没有拖动就是单击框外：保留原来的裁剪框
				const point = current.view.toImage(event.clientX, event.clientY);
				const moved = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * current.view.scale;
				if (moved < MOVE_THRESHOLD) current.onCropChange(drag.previous);
				break;
			}
			case "draw": {
				if (!live) break;
				let annotation = live;
				if ((annotation.kind === "pen" || annotation.kind === "highlighter") && !drag.straight) {
					annotation = { ...annotation, points: simplifyPath(drag.points, 0.35 * current.unit) };
				}
				if (!isDegenerate(annotation)) current.onCommit([...current.annotations, annotation], { select: annotation.id });
				break;
			}
			case "move":
				if (drag.moved && live) current.onCommit(replaceOrAppend(current.annotations, live));
				else if (drag.editOnClick) startTextEdit(drag.original);
				break;
			case "counter":
				if (drag.moved && live) {
					current.onCommit(replaceOrAppend(current.annotations, live), { coalesceKey: `place:${live.id}` });
				}
				break;
			case "resize":
				if (live) current.onCommit(replaceOrAppend(current.annotations, live));
				break;
			default:
				break;
		}
		requestDraw();
		updateCursor();
	};

	const onPointerLeave = () => {
		if (dragRef.current) return;
		lastPointerRef.current = null;
		if (hoverIdRef.current) {
			hoverIdRef.current = null;
			requestDraw();
		}
	};

	const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
		const current = propsRef.current;
		if (!current.source) return;
		const point = current.view.toImage(event.clientX, event.clientY);
		if (current.crop) {
			if (cropHitAt(current.crop, point, CROP_TOLERANCE / current.view.scale) === "move") current.onCropConfirm();
			return;
		}
		const text = pickAnnotation(current.annotations, point, tolerance(), {
			allowInside: false,
			filter: (annotation) => annotation.kind === "text",
		});
		if (text) startTextEdit(text);
	};

	// ---------------------------------------------------------------- 文字编辑

	// 开始编辑时自动聚焦，光标放到末尾
	const editingKey = textEdit ? (textEdit.id ?? "new") : null;
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!editingKey || !textarea) return;
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	}, [editingKey]);

	const onTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
			event.preventDefault();
			event.stopPropagation();
			props.onTextCommit();
		}
	};

	let textarea = null;
	if (textEdit) {
		const { scale, origin } = view;
		const padding = textPadding(textEdit.size, textEdit.style);
		const box = measureText(textEdit.text || " ", textEdit.size, textEdit.style);
		const pill = textEdit.style === "pill";
		textarea = (
			<textarea
				ref={textareaRef}
				value={textEdit.text}
				spellCheck={false}
				rows={1}
				className="absolute resize-none overflow-hidden whitespace-pre border border-dashed border-apple-blue outline-none"
				style={{
					left: origin.x + textEdit.x * scale,
					top: origin.y + textEdit.y * scale,
					width: box.w * scale + 6,
					height: box.h * scale + 2,
					padding: `${padding.y * scale}px ${padding.x * scale}px`,
					fontFamily: TEXT_FONT_FAMILY,
					fontWeight: TEXT_FONT_WEIGHT,
					fontSize: textEdit.size * scale,
					lineHeight: TEXT_LINE_HEIGHT,
					color: pill ? contrastColor(textEdit.color) : textEdit.color,
					caretColor: pill ? contrastColor(textEdit.color) : textEdit.color,
					background: pill ? textEdit.color : "transparent",
					borderRadius: pill ? Math.min((box.h * scale) / 2, textEdit.size * scale * 0.6) : 2,
					boxSizing: "border-box",
				}}
				onChange={(event) => props.onTextChange(event.target.value)}
				onKeyDown={onTextKeyDown}
				onBlur={() => props.onTextCommit()}
				onPointerDown={(event) => event.stopPropagation()}
			/>
		);
	}

	return (
		<div
			ref={(element) => {
				// React 18 的 ref 类型不接受 RefObject<T | null>，用回调写入
				(view.viewportRef as MutableRefObject<HTMLDivElement | null>).current = element;
			}}
			className="relative h-full w-full overflow-hidden"
		>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 h-full w-full touch-none"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onPointerLeave={onPointerLeave}
				onDoubleClick={onDoubleClick}
				onContextMenu={(event) => event.preventDefault()}
			/>
			{textarea}
		</div>
	);
}
