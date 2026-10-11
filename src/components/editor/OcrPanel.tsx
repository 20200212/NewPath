import { CircleAlert, Copy, Loader2, RotateCw, ScanText, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/ToolButton";
import { useI18n } from "@/i18n";

interface OcrPanelProps {
	status: "idle" | "loading" | "done" | "error";
	text: string;
	error: string | null;
	onTextChange: (text: string) => void;
	onRetry: () => void;
	onCopy: () => void;
	onClose: () => void;
}

const WIDTH_STORAGE_KEY = "editor.ocrPanelWidth";
const FONT_STORAGE_KEY = "editor.ocrFontSize";
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 240;
/** 面板最多占窗口宽度的这个比例，给画布留出空间。 */
const MAX_WIDTH_RATIO = 0.7;
const DEFAULT_FONT = 14;
const MIN_FONT = 11;
const MAX_FONT = 28;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function clampWidth(width: number) {
	return Math.round(clamp(width, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth * MAX_WIDTH_RATIO)));
}

function loadNumber(key: string, fallback: number) {
	const value = Number(localStorage.getItem(key));
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 右侧的提取文字面板：识别结果可以直接修改后复制；左边缘可拖动调整宽度，Ctrl + 滚轮调整字号。 */
export function OcrPanel({ status, text, error, onTextChange, onRetry, onCopy, onClose }: OcrPanelProps) {
	const { t } = useI18n();
	const labels = t.editor.ocr;
	const lineCount = text ? text.split("\n").filter((line) => line.trim()).length : 0;
	const [width, setWidth] = useState(() => clampWidth(loadNumber(WIDTH_STORAGE_KEY, DEFAULT_WIDTH)));
	const [fontSize, setFontSize] = useState(() => clamp(loadNumber(FONT_STORAGE_KEY, DEFAULT_FONT), MIN_FONT, MAX_FONT));
	const [resizing, setResizing] = useState(false);

	const commitWidth = (next: number) => {
		setWidth(next);
		localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
	};

	const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = width;
		let latest = startWidth;
		setResizing(true);
		const onMove = (move: PointerEvent) => {
			// 拖动条在面板左侧，往左拖是变宽
			latest = clampWidth(startWidth + startX - move.clientX);
			setWidth(latest);
		};
		const onUp = () => {
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			handle.removeEventListener("pointercancel", onUp);
			setResizing(false);
			commitWidth(latest);
		};
		handle.addEventListener("pointermove", onMove);
		handle.addEventListener("pointerup", onUp);
		handle.addEventListener("pointercancel", onUp);
	};

	// React 的 onWheel 是被动监听，拦不住 Ctrl + 滚轮的页面缩放，这里直接挂原生监听
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const hasText = status === "done" && !!text;
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			setFontSize((current) => {
				const next = clamp(current + (event.deltaY < 0 ? 1 : -1), MIN_FONT, MAX_FONT);
				localStorage.setItem(FONT_STORAGE_KEY, String(next));
				return next;
			});
		};
		textarea.addEventListener("wheel", onWheel, { passive: false });
		return () => textarea.removeEventListener("wheel", onWheel);
	}, [hasText]);

	return (
		<aside style={{ width }} className="relative flex min-h-0 flex-1 flex-col border-l border-gray-200/70 bg-white">
			<div
				title={labels.resizeHandle}
				className={`absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-apple-blue/30 ${resizing ? "bg-apple-blue/40" : ""}`}
				onPointerDown={startResize}
				onDoubleClick={() => commitWidth(clampWidth(DEFAULT_WIDTH))}
			/>
			<div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3">
				<ScanText size={16} strokeWidth={2.5} className="text-apple-blue" />
				<span className="text-sm font-black text-gray-800">{labels.title}</span>
				<button
					type="button"
					title={labels.close}
					className="ml-auto rounded-lg p-1 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700 active:scale-90"
					onClick={onClose}
				>
					<X size={16} strokeWidth={2.5} />
				</button>
			</div>

			<div className="flex min-h-0 flex-1 flex-col p-3">
				{status === "loading" || status === "idle" ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm font-bold text-gray-400">
						<Loader2 size={22} className="animate-spin text-apple-blue" />
						{labels.loading}
					</div>
				) : status === "error" ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center text-sm font-bold text-gray-500">
						<CircleAlert size={22} className="text-apple-red" />
						<span>{error ?? labels.failed}</span>
						<ChipButton onClick={onRetry}>
							<RotateCw size={14} strokeWidth={2.5} />
							{labels.retry}
						</ChipButton>
					</div>
				) : !text ? (
					<div className="flex flex-1 items-center justify-center text-sm font-bold text-gray-400">{labels.empty}</div>
				) : (
					<>
						<textarea
							ref={textareaRef}
							value={text}
							spellCheck={false}
							title={labels.fontHint}
							style={{ fontSize }}
							className="min-h-0 flex-1 resize-none rounded-xl border border-gray-200 bg-apple-bg/50 p-3 leading-relaxed text-gray-800 outline-none focus:border-apple-blue/50"
							onChange={(event) => onTextChange(event.target.value)}
						/>
						<div className="mt-2 flex items-center justify-between text-xs font-bold text-gray-400">
							<span>{labels.lineCount(lineCount)}</span>
							<span>{labels.fontSize(fontSize)}</span>
						</div>
					</>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-3 py-3">
				<ChipButton disabled={status === "loading"} onClick={onRetry}>
					<RotateCw size={14} strokeWidth={2.5} />
					{labels.rescan}
				</ChipButton>
				<Button size="sm" disabled={!text || status !== "done"} onClick={onCopy}>
					<Copy size={15} strokeWidth={2.5} />
					{labels.copyText}
				</Button>
			</div>
		</aside>
	);
}
