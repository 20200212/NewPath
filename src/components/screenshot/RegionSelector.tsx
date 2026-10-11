import { Copy, Download, ImagePlus, Link, Pencil, Pin, X, type LucideIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";
import type { CaptureAction, CaptureMode, DetectedWindow } from "../../../electron/ipcTypes";
import { createMockScreenshot, createMockWindows } from "@/lib/mockImage";
import {
	containsPoint,
	findWindowAt,
	HANDLES,
	isClick,
	moveRect,
	rectFromPoints,
	resizeRect,
	type Handle,
	type Point,
	type Rect,
} from "@/lib/selectionGeometry";

type Drag =
	| { kind: "draw"; start: Point }
	| { kind: "move"; start: Point; origin: Rect }
	| { kind: "resize"; handle: Handle; start: Point; origin: Rect };

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

function handlePosition(handle: Handle): CSSProperties {
	const x = handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%";
	const y = handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%";
	return { left: x, top: y, cursor: HANDLE_CURSORS[handle] };
}

const TOOLBAR_HEIGHT = 44;
/** 选区外的遮罩：用超大的外阴影盖住选区以外的部分。 */
const DIM_SHADOW = "0 0 0 100vmax rgba(0, 0, 0, 0.45)";
/** 窗口列表还没到时单击，最多等这么久；超时仍没有列表就截取整个屏幕。 */
const PENDING_CLICK_TIMEOUT_MS = 1000;

interface LoadedSession {
	id: number;
	imageUrl: string;
	scaleFactor: number;
	mode: CaptureMode;
}

/** 解码完成后再显示，保证第一帧就是完整的截图。 */
async function decodeImage(url: string) {
	const image = new Image();
	image.src = url;
	await image.decode();
}

/** 全屏选区窗口：背景是冻结的屏幕画面，悬停高亮窗口、单击选中，或拖拽选择区域。 */
export function RegionSelector() {
	const api = window.electronAPI;
	const [session, setSession] = useState<LoadedSession | null>(null);
	const [selection, setSelection] = useState<Rect | null>(null);
	/** 截图时屏幕上的窗口；null 表示还没收到列表，这时不做悬停高亮。 */
	const [windows, setWindows] = useState<DetectedWindow[] | null>(null);
	const [hover, setHover] = useState<DetectedWindow | null>(null);
	const dragRef = useRef<Drag | null>(null);
	const [dragging, setDragging] = useState(false);
	const sessionIdRef = useRef(0);
	/** 最后已知的光标位置：会话开始时由主进程给出，之后随指针事件更新。 */
	const pointerRef = useRef<Point | null>(null);
	/** 窗口列表到达前的单击：等列表到了再决定选中哪个窗口。 */
	const pendingClickRef = useRef<{ point: Point; timer: number } | null>(null);

	const clearPendingClick = useCallback(() => {
		const pending = pendingClickRef.current;
		if (!pending) return;
		window.clearTimeout(pending.timer);
		pendingClickRef.current = null;
	}, []);

	useEffect(() => clearPendingClick, [clearPendingClick]);

	// 窗口常驻复用：每次截图开始或结束时同步一次会话
	useEffect(() => {
		if (!api) {
			setSession({
				id: 0,
				imageUrl: createMockScreenshot(window.innerWidth, window.innerHeight),
				scaleFactor: window.devicePixelRatio,
				mode: new URLSearchParams(window.location.search).get("mode") === "stitch" ? "stitch" : "capture",
			});
			setWindows(createMockWindows(window.innerWidth, window.innerHeight));
			return;
		}
		let disposed = false;
		const sync = async () => {
			const info = await api.getCaptureSession();
			if (disposed) return;
			if (!info) {
				sessionIdRef.current = 0;
				pointerRef.current = null;
				clearPendingClick();
				dragRef.current = null;
				setDragging(false);
				setSelection(null);
				setWindows(null);
				setHover(null);
				setSession(null);
				return;
			}
			if (info.id === sessionIdRef.current) return;
			sessionIdRef.current = info.id;
			const imageUrl = URL.createObjectURL(new Blob([info.imageBytes as BlobPart], { type: info.mimeType }));
			try {
				await decodeImage(imageUrl);
			} catch {
				// 解码失败也继续，主进程的超时兜底会让窗口显示出来
			}
			if (disposed || sessionIdRef.current !== info.id) {
				URL.revokeObjectURL(imageUrl);
				return;
			}
			pointerRef.current = info.cursor;
			clearPendingClick();
			dragRef.current = null;
			setDragging(false);
			setSelection(null);
			setWindows(null);
			setHover(null);
			setSession({ id: info.id, imageUrl, scaleFactor: info.scaleFactor, mode: info.mode });
		};
		void sync();
		const unsubscribe = api.onCaptureChanged(() => void sync());
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [api, clearPendingClick]);

	// 窗口列表比画面晚到：会话就绪后拉取一次，之后收到通知再拉取；用会话 id 丢弃过期的列表
	const sessionId = session?.id;
	useEffect(() => {
		if (!api || sessionId === undefined) return;
		let disposed = false;
		const sync = async () => {
			const info = await api.getCaptureWindows();
			if (!disposed && info && info.sessionId === sessionId) setWindows(info.windows);
		};
		void sync();
		const unsubscribe = api.onCaptureWindowsChanged(() => void sync());
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [api, sessionId]);

	// 新画面提交后再等两帧（确保已经绘制到屏幕），然后通知主进程显示窗口
	useEffect(() => {
		if (!session) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => void api?.captureReady(session.id));
		});
		return () => {
			cancelAnimationFrame(frame);
			if (session.imageUrl.startsWith("blob:")) URL.revokeObjectURL(session.imageUrl);
		};
	}, [api, session]);

	const bounds = { width: window.innerWidth, height: window.innerHeight };
	const stitching = session?.mode === "stitch";

	/** 光标下的窗口；没有命中任何窗口时就是整个屏幕。 */
	const windowAt = (point: Point): DetectedWindow | null => {
		if (!windows) return null;
		return findWindowAt(windows, point) ?? { title: "", rect: { x: 0, y: 0, ...bounds } };
	};

	// 列表到达时按最后已知的光标位置补算：鼠标不动也能立刻高亮光标下的窗口，列表到达前的单击也在这时落定；之后的悬停交给 pointermove
	useEffect(() => {
		if (!windows) return;
		const pending = pendingClickRef.current;
		if (pending) {
			clearPendingClick();
			setSelection(windowAt(pending.point)?.rect ?? null);
			return;
		}
		const point = pointerRef.current;
		if (point && !dragRef.current && !selection) setHover(windowAt(point));
	}, [windows]);

	const cancel = useCallback(() => {
		if (api) void api.cancelCapture();
		else setSelection(null);
	}, [api]);

	const finish = useCallback(
		(action: CaptureAction) => {
			if (!selection || selection.width < 1 || selection.height < 1) return;
			if (api) void api.finishCapture({ rect: selection, action });
			else console.info("[dev:ui] finishCapture", action, selection);
		},
		[api, selection],
	);

	/** Enter / 双击的默认动作：普通截图复制图片，拼接模式加入拼接。 */
	const confirm = useCallback(() => finish(stitching ? "stitch" : "copy"), [finish, stitching]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();
			if (event.key === "Escape") cancel();
			else if (event.key === "Enter") confirm();
			else if (stitching) return;
			else if (mod && key === "c") finish("copy");
			else if (mod && key === "s") {
				event.preventDefault();
				finish("save");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [cancel, confirm, finish, stitching]);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const point = { x: event.clientX, y: event.clientY };
		const handle = (event.target as HTMLElement).dataset.handle as Handle | undefined;
		pointerRef.current = point;
		clearPendingClick();
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(true);

		if (selection && handle) dragRef.current = { kind: "resize", handle, start: point, origin: selection };
		else if (selection && containsPoint(selection, point))
			dragRef.current = { kind: "move", start: point, origin: selection };
		else {
			dragRef.current = { kind: "draw", start: point };
			setSelection(null);
		}
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const point = { x: event.clientX, y: event.clientY };
		pointerRef.current = point;
		const drag = dragRef.current;
		if (!drag) {
			if (!selection) setHover(windowAt(point));
			return;
		}
		const dx = point.x - drag.start.x;
		const dy = point.y - drag.start.y;
		if (drag.kind === "draw") {
			// 抖动几个像素不算拖拽，否则单击选窗口时高亮会闪一下
			if (isClick(drag.start, point)) return;
			setHover(null);
			setSelection(rectFromPoints(drag.start, point));
		} else if (drag.kind === "move") setSelection(moveRect(drag.origin, dx, dy, bounds));
		else setSelection(resizeRect(drag.origin, drag.handle, dx, dy, bounds));
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		dragRef.current = null;
		setDragging(false);
		const point = { x: event.clientX, y: event.clientY };
		// 单击（没有拖拽）：选中光标下的窗口；还没收到窗口列表时先记下来，等列表到了再选，超时就截取整个屏幕
		if (drag?.kind === "draw" && isClick(drag.start, point)) {
			setHover(null);
			if (windows) setSelection(windowAt(point)?.rect ?? null);
			else {
				const timer = window.setTimeout(() => {
					pendingClickRef.current = null;
					setSelection({ x: 0, y: 0, ...bounds });
				}, PENDING_CLICK_TIMEOUT_MS);
				pendingClickRef.current = { point, timer };
			}
		}
	};

	const onContextMenu = (event: ReactMouseEvent) => {
		event.preventDefault();
		if (selection) {
			setSelection(null);
			setHover(windowAt({ x: event.clientX, y: event.clientY }));
		} else cancel();
	};

	const onDoubleClick = (event: ReactMouseEvent) => {
		if (selection && containsPoint(selection, { x: event.clientX, y: event.clientY })) confirm();
	};

	if (!session) return <div className="fixed inset-0 bg-black" />;

	const scale = session.scaleFactor;
	const toolbarBelow = selection ? selection.y + selection.height + TOOLBAR_HEIGHT + 8 <= bounds.height : true;
	const sizeLabel = (rect: Rect) => `${Math.round(rect.width * scale)} × ${Math.round(rect.height * scale)}`;

	return (
		<div
			className="fixed inset-0 cursor-crosshair select-none overflow-hidden"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onContextMenu={onContextMenu}
			onDoubleClick={onDoubleClick}
		>
			<img
				src={session.imageUrl}
				alt=""
				draggable={false}
				className="pointer-events-none absolute inset-0 h-full w-full"
			/>

			{selection ? (
				<div
					className="absolute cursor-move border-2 border-apple-blue"
					style={{
						left: selection.x,
						top: selection.y,
						width: selection.width,
						height: selection.height,
						boxShadow: DIM_SHADOW,
					}}
				>
					{HANDLES.map((handle) => (
						<span
							key={handle}
							data-handle={handle}
							className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-apple-blue bg-white shadow"
							style={handlePosition(handle)}
						/>
					))}
					<SizeLabel rect={selection} text={sizeLabel(selection)} />
				</div>
			) : hover ? (
				<div
					className="pointer-events-none absolute border-[3px] border-apple-blue transition-[left,top,width,height] duration-75"
					style={{
						left: hover.rect.x,
						top: hover.rect.y,
						width: hover.rect.width,
						height: hover.rect.height,
						boxShadow: DIM_SHADOW,
					}}
				>
					<SizeLabel rect={hover.rect} text={hover.title ? `${hover.title} · ${sizeLabel(hover.rect)}` : sizeLabel(hover.rect)} />
				</div>
			) : (
				<div className="pointer-events-none absolute inset-0 bg-black/45" />
			)}

			{!selection && (
				<p className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#1C1C1E]/85 px-5 py-2.5 text-sm font-bold tracking-wide text-white shadow-2xl backdrop-blur-md">
					{stitching ? "选择要拼接的区域" : "单击选择窗口，拖动选择区域"} · Esc 退出
				</p>
			)}

			{selection && !dragging && (
				<div
					className="absolute flex items-center gap-1 rounded-2xl border border-white bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl"
					style={{
						right: Math.max(4, bounds.width - selection.x - selection.width),
						top: toolbarBelow
							? selection.y + selection.height + 8
							: Math.max(4, selection.y - TOOLBAR_HEIGHT - 8),
						height: TOOLBAR_HEIGHT,
					}}
					onPointerDown={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
				>
					{stitching ? (
						<>
							<ToolbarButton icon={ImagePlus} label="添加到拼接" hint="Enter" onClick={() => finish("stitch")} />
							<ToolbarButton icon={X} label="取消" hint="Esc" onClick={cancel} />
						</>
					) : (
						<>
							<ToolbarButton icon={Pencil} label="编辑" onClick={() => finish("edit")} />
							<ToolbarButton icon={Download} label="保存" hint="Ctrl+S" onClick={() => finish("save")} />
							<ToolbarButton icon={Link} label="复制路径" onClick={() => finish("copy-path")} />
							<ToolbarButton icon={Copy} label="复制图片" hint="Enter" onClick={() => finish("copy")} />
							<ToolbarButton icon={Pin} label="钉住" onClick={() => finish("pin")} />
							<ToolbarButton icon={X} label="取消" hint="Esc" onClick={cancel} />
						</>
					)}
				</div>
			)}
		</div>
	);
}

/** 选区左上角的尺寸标签；贴着屏幕顶部时放到框内。 */
function SizeLabel({ rect, text }: { rect: Rect; text: string }) {
	return (
		<div
			className={`pointer-events-none absolute left-0 max-w-[60vw] truncate whitespace-nowrap rounded-lg bg-[#1C1C1E]/85 px-2 py-1 font-mono text-xs font-bold text-white backdrop-blur-md ${
				rect.y < 32 ? "top-1 ml-1" : "-top-8"
			}`}
		>
			{text}
		</div>
	);
}

interface ToolbarButtonProps {
	icon: LucideIcon;
	label: string;
	hint?: string;
	onClick: () => void;
}

function ToolbarButton({ icon: Icon, label, hint, onClick }: ToolbarButtonProps) {
	return (
		<button
			type="button"
			title={hint ? `${label} (${hint})` : label}
			className="flex h-full items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-900 active:scale-95"
			onClick={onClick}
		>
			<Icon size={16} strokeWidth={2.5} />
			{label}
		</button>
	);
}
