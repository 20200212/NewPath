import { Copy, Download, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { useI18n } from "@/i18n";
import { createMockScreenshot } from "@/lib/mockImage";

const ZOOM_STEP = 1.1;
const MIN_OPACITY = 0.2;
/** 窗口太窄时工具栏只留关闭按钮。 */
const FULL_TOOLBAR_WIDTH = 220;
const HINT_DURATION_MS = 1200;

/** 钉图窗口：置顶显示一张截图。拖动移动，滚轮缩放，Ctrl+滚轮调透明度，双击或 Esc 关闭。 */
export function PinnedImage() {
	const api = window.electronAPI;
	const { t } = useI18n();
	const text = t.capture.pin;
	const [src, setSrc] = useState<string | null>(null);
	const [opacity, setOpacity] = useState(1);
	const [hint, setHint] = useState<string | null>(null);
	const [width, setWidth] = useState(window.innerWidth);
	const draggingRef = useRef(false);
	const frameRef = useRef(0);
	const hintTimer = useRef(0);

	useEffect(() => {
		if (!api) {
			setSrc(createMockScreenshot(480, 270));
			return;
		}
		void api.getPinImage().then((info) => setSrc(info?.dataUrl ?? null));
	}, [api]);

	useEffect(() => {
		const onResize = () => setWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const showHint = useCallback((text: string) => {
		setHint(text);
		window.clearTimeout(hintTimer.current);
		hintTimer.current = window.setTimeout(() => setHint(null), HINT_DURATION_MS);
	}, []);

	const close = useCallback(() => void api?.closeWindow(), [api]);

	const copy = useCallback(async () => {
		await api?.pinCopy();
		showHint(text.copied);
	}, [api, showHint, text]);

	const save = useCallback(async () => {
		const result = await api?.pinSave();
		if (result?.saved) showHint(text.saved);
	}, [api, showHint, text]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();
			if (event.key === "Escape") close();
			else if (mod && key === "c") void copy();
			else if (mod && key === "s") {
				event.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [close, copy, save]);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		draggingRef.current = true;
		void api?.pinDragStart();
	};

	// 每帧最多移动一次窗口
	const onPointerMove = () => {
		if (!draggingRef.current || frameRef.current) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = 0;
			if (draggingRef.current) void api?.pinDragMove();
		});
	};

	const onPointerUp = () => {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		void api?.pinDragEnd();
	};

	const onWheel = (event: WheelEvent) => {
		const larger = event.deltaY < 0;
		if (event.ctrlKey || event.metaKey) {
			const next = Math.min(1, Math.max(MIN_OPACITY, opacity + (larger ? 0.05 : -0.05)));
			setOpacity(next);
			showHint(text.opacityHint(Math.round(next * 100)));
			return;
		}
		void api?.pinZoom(larger ? ZOOM_STEP : 1 / ZOOM_STEP).then((percent) => {
			if (percent !== null && percent !== undefined) showHint(`${percent}%`);
		});
	};

	return (
		<div
			className="group relative h-screen w-screen cursor-move select-none overflow-hidden"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onWheel={onWheel}
			onDoubleClick={close}
		>
			{src && (
				<img
					src={src}
					alt={text.alt}
					draggable={false}
					className="pointer-events-none h-full w-full object-fill"
					style={{ opacity }}
					onLoad={() => void api?.pinReady()}
				/>
			)}
			<div className="pointer-events-none absolute inset-0 border border-black/15 group-hover:border-2 group-hover:border-apple-blue/70" />

			{hint && (
				<div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[#1C1C1E]/80 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md">
					{hint}
				</div>
			)}

			<div
				className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-xl border border-white/80 bg-white/90 p-0.5 opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100"
				onPointerDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
			>
				{width >= FULL_TOOLBAR_WIDTH && (
					<>
						<input
							type="range"
							title={text.opacityTitle}
							min={MIN_OPACITY * 100}
							max={100}
							value={Math.round(opacity * 100)}
							className="mx-1 h-1 w-16 cursor-pointer accent-apple-blue"
							onChange={(event) => setOpacity(Number(event.target.value) / 100)}
						/>
						<PinButton icon={Copy} label={text.copyTitle} onClick={() => void copy()} />
						<PinButton icon={Download} label={text.saveTitle} onClick={() => void save()} />
					</>
				)}
				<PinButton icon={X} label={text.closeTitle} danger onClick={close} />
			</div>
		</div>
	);
}

interface PinButtonProps {
	icon: LucideIcon;
	label: string;
	danger?: boolean;
	onClick: () => void;
}

function PinButton({ icon: Icon, label, danger, onClick }: PinButtonProps) {
	return (
		<button
			type="button"
			title={label}
			className={`rounded-lg p-1.5 text-gray-500 transition-all active:scale-90 ${
				danger ? "hover:bg-red-50 hover:text-apple-red" : "hover:bg-gray-100 hover:text-gray-900"
			}`}
			onClick={onClick}
		>
			<Icon size={14} strokeWidth={2.5} />
		</button>
	);
}
