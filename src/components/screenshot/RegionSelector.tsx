import { Copy, Download, Pencil, X, type LucideIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";
import type { CaptureAction } from "../../../electron/ipcTypes";
import { createMockScreenshot } from "@/lib/mockImage";
import {
	containsPoint,
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

interface LoadedSession {
	id: number;
	imageUrl: string;
	scaleFactor: number;
}

/** 解码完成后再显示，保证第一帧就是完整的截图。 */
async function decodeImage(url: string) {
	const image = new Image();
	image.src = url;
	await image.decode();
}

/** 全屏选区窗口：背景是冻结的屏幕画面，拖拽选择区域。 */
export function RegionSelector() {
	const api = window.electronAPI;
	const [session, setSession] = useState<LoadedSession | null>(null);
	const [selection, setSelection] = useState<Rect | null>(null);
	const dragRef = useRef<Drag | null>(null);
	const [dragging, setDragging] = useState(false);
	const sessionIdRef = useRef(0);

	// 窗口常驻复用：每次截图开始或结束时同步一次会话
	useEffect(() => {
		if (!api) {
			setSession({
				id: 0,
				imageUrl: createMockScreenshot(window.innerWidth, window.innerHeight),
				scaleFactor: window.devicePixelRatio,
			});
			return;
		}
		let disposed = false;
		const sync = async () => {
			const info = await api.getCaptureSession();
			if (disposed) return;
			if (!info) {
				sessionIdRef.current = 0;
				dragRef.current = null;
				setDragging(false);
				setSelection(null);
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
			dragRef.current = null;
			setDragging(false);
			setSelection(null);
			setSession({ id: info.id, imageUrl, scaleFactor: info.scaleFactor });
		};
		void sync();
		const unsubscribe = api.onCaptureChanged(() => void sync());
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [api]);

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

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			if (event.key === "Escape") cancel();
			else if (event.key === "Enter" || (mod && event.key.toLowerCase() === "c")) finish("copy");
			else if (mod && event.key.toLowerCase() === "s") {
				event.preventDefault();
				finish("save");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [cancel, finish]);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const point = { x: event.clientX, y: event.clientY };
		const handle = (event.target as HTMLElement).dataset.handle as Handle | undefined;
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
		const drag = dragRef.current;
		if (!drag) return;
		const point = { x: event.clientX, y: event.clientY };
		const dx = point.x - drag.start.x;
		const dy = point.y - drag.start.y;
		if (drag.kind === "draw") setSelection(rectFromPoints(drag.start, point));
		else if (drag.kind === "move") setSelection(moveRect(drag.origin, dx, dy, bounds));
		else setSelection(resizeRect(drag.origin, drag.handle, dx, dy, bounds));
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		dragRef.current = null;
		setDragging(false);
		// 单击（没有拖拽）视为截取整个屏幕
		if (drag?.kind === "draw" && isClick(drag.start, { x: event.clientX, y: event.clientY })) {
			setSelection({ x: 0, y: 0, ...bounds });
		}
	};

	const onContextMenu = (event: ReactMouseEvent) => {
		event.preventDefault();
		if (selection) setSelection(null);
		else cancel();
	};

	const onDoubleClick = (event: ReactMouseEvent) => {
		if (selection && containsPoint(selection, { x: event.clientX, y: event.clientY })) finish("copy");
	};

	if (!session) return <div className="fixed inset-0 bg-black" />;

	const scale = session.scaleFactor;
	const toolbarBelow = selection ? selection.y + selection.height + TOOLBAR_HEIGHT + 8 <= bounds.height : true;

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
						boxShadow: "0 0 0 100vmax rgba(0, 0, 0, 0.45)",
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
					<div className="pointer-events-none absolute -top-8 left-0 whitespace-nowrap rounded-lg bg-[#1C1C1E]/85 px-2 py-1 font-mono text-xs font-bold text-white backdrop-blur-md">
						{Math.round(selection.width * scale)} × {Math.round(selection.height * scale)}
					</div>
				</div>
			) : (
				<div className="pointer-events-none absolute inset-0 bg-black/45">
					<p className="absolute left-1/2 top-8 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#1C1C1E]/85 px-5 py-2.5 text-sm font-bold tracking-wide text-white shadow-2xl backdrop-blur-md">
						拖动选择区域，单击截取全屏 · Esc 退出
					</p>
				</div>
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
					<ToolbarButton icon={Pencil} label="编辑" onClick={() => finish("edit")} />
					<ToolbarButton icon={Download} label="保存" hint="Ctrl+S" onClick={() => finish("save")} />
					<ToolbarButton icon={X} label="取消" hint="Esc" onClick={cancel} />
					<ToolbarButton icon={Copy} label="复制" hint="Enter" primary onClick={() => finish("copy")} />
				</div>
			)}
		</div>
	);
}

interface ToolbarButtonProps {
	icon: LucideIcon;
	label: string;
	hint?: string;
	primary?: boolean;
	onClick: () => void;
}

function ToolbarButton({ icon: Icon, label, hint, primary, onClick }: ToolbarButtonProps) {
	return (
		<button
			type="button"
			title={hint ? `${label} (${hint})` : label}
			className={`flex h-full items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-all duration-200 active:scale-95 ${
				primary
					? "bg-apple-blue text-white shadow-key-blue-sm hover:bg-apple-blue-hover active:translate-y-0.5 active:shadow-none"
					: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
			}`}
			onClick={onClick}
		>
			<Icon size={16} strokeWidth={2.5} />
			{label}
		</button>
	);
}
