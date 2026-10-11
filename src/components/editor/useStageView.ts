import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point, Size } from "@/editor/types";
import {
	clampPan,
	clampZoom,
	fitZoom,
	imageOrigin,
	normalizeWheelDelta,
	viewCenter,
	wheelZoomFactor,
	ZOOM_STEP,
	zoomAround,
	type Insets,
} from "@/editor/viewport";

/** 画布四周留给浮动样式条和底部缩放条的空间。 */
export const STAGE_INSETS: Insets = { top: 72, right: 32, bottom: 92, left: 32 };

/** 输入框里按空格是打字，不是平移。 */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
	return target.tagName === "INPUT" && !["range", "color", "checkbox", "button"].includes((target as HTMLInputElement).type);
}

export interface StageView {
	viewportRef: React.RefObject<HTMLDivElement | null>;
	viewport: Size;
	/** 显示的缩放比例，1 = 100%。 */
	zoom: number;
	/** 每个图片像素占多少 CSS 像素。 */
	scale: number;
	/** 是否处于"适应窗口"状态（窗口大小变化时自动重新适配）。 */
	fitting: boolean;
	/** 图片左上角在视口里的位置（CSS 像素）。 */
	origin: Point;
	handMode: boolean;
	spaceHeld: boolean;
	setZoom: (zoom: number, anchor?: Point) => void;
	zoomIn: () => void;
	zoomOut: () => void;
	actualSize: () => void;
	fit: () => void;
	panBy: (dx: number, dy: number) => void;
	setHandMode: (value: boolean) => void;
	/** 视口外的鼠标坐标（clientX / clientY）→ 图片像素。 */
	toImage: (clientX: number, clientY: number) => Point;
}

/** 编辑器画布的缩放与平移。unit 是截图的缩放比例：100% 表示和截图时屏幕上看到的一样大。 */
export function useStageView(image: Size, unit: number): StageView {
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
	/** null 表示适应窗口。 */
	const [zoomState, setZoomState] = useState<number | null>(null);
	const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
	const [handMode, setHandMode] = useState(false);
	const [spaceHeld, setSpaceHeld] = useState(false);

	useLayoutEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const fitting = zoomState === null;
	const zoom = zoomState ?? fitZoom(image, viewport, STAGE_INSETS, unit);
	const scale = zoom / unit;
	const currentPan = fitting ? { x: 0, y: 0 } : clampPan(pan, image, scale, viewport, STAGE_INSETS);
	const origin = imageOrigin(image, scale, currentPan, viewport, STAGE_INSETS);

	// 原生事件监听器（滚轮）和回调里读取最新状态
	const latest = useRef({ image, unit, viewport, zoom, scale, pan: currentPan, origin, handMode, spaceHeld });
	latest.current = { image, unit, viewport, zoom, scale, pan: currentPan, origin, handMode, spaceHeld };

	const setZoom = useCallback((next: number, anchor?: Point) => {
		const state = latest.current;
		const nextZoom = clampZoom(next);
		const nextScale = nextZoom / state.unit;
		const center = viewCenter(state.viewport, STAGE_INSETS);
		const nextPan = zoomAround(state.pan, state.scale, nextScale, anchor ?? center, center);
		setZoomState(nextZoom);
		setPan(clampPan(nextPan, state.image, nextScale, state.viewport, STAGE_INSETS));
	}, []);

	const panBy = useCallback((dx: number, dy: number) => {
		const state = latest.current;
		const next = { x: state.pan.x + dx, y: state.pan.y + dy };
		// 适应窗口状态下平移，先固定当前缩放比例
		setZoomState(state.zoom);
		setPan(clampPan(next, state.image, state.scale, state.viewport, STAGE_INSETS));
	}, []);

	const fit = useCallback(() => {
		setZoomState(null);
		setPan({ x: 0, y: 0 });
	}, []);

	const toImage = useCallback((clientX: number, clientY: number): Point => {
		const state = latest.current;
		const rect = viewportRef.current?.getBoundingClientRect();
		const x = clientX - (rect?.left ?? 0);
		const y = clientY - (rect?.top ?? 0);
		return { x: (x - state.origin.x) / state.scale, y: (y - state.origin.y) / state.scale };
	}, []);

	// 滚轮：默认缩放（以光标为中心）；Shift、空格、抓手模式或横向滑动时平移
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			if ((event.target as HTMLElement).closest("button, input, textarea, [data-no-wheel]")) return;
			event.preventDefault();
			const state = latest.current;
			const dx = normalizeWheelDelta(event.deltaX, event.deltaMode, state.viewport.width);
			const dy = normalizeWheelDelta(event.deltaY, event.deltaMode, state.viewport.height);
			if (event.shiftKey || state.handMode || state.spaceHeld || Math.abs(dx) > Math.abs(dy)) {
				// Shift 把竖向滚动当作横向平移
				if (event.shiftKey && dx === 0) panBy(-dy, 0);
				else panBy(-dx, -dy);
				return;
			}
			const rect = element.getBoundingClientRect();
			const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			setZoom(state.zoom * wheelZoomFactor(dy, event.ctrlKey || event.metaKey), anchor);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [panBy, setZoom]);

	// 按住空格临时切换成抓手
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code !== "Space" || isEditableTarget(event.target)) return;
			event.preventDefault();
			setSpaceHeld(true);
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		const onBlur = () => setSpaceHeld(false);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	return {
		viewportRef,
		viewport,
		zoom,
		scale,
		fitting,
		origin,
		handMode,
		spaceHeld,
		setZoom,
		zoomIn: useCallback(() => setZoom(latest.current.zoom * ZOOM_STEP), [setZoom]),
		zoomOut: useCallback(() => setZoom(latest.current.zoom / ZOOM_STEP), [setZoom]),
		actualSize: useCallback(() => setZoom(1), [setZoom]),
		fit,
		panBy,
		setHandMode,
		toImage,
	};
}
