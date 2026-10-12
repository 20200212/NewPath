import { CornerDownLeft, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ScrollCaptureState, ScrollStatus } from "../../../electron/ipcTypes";
import { useI18n } from "@/i18n";
import { mockScrollCaptureApi } from "@/lib/mockOnboarding";
import { displayedScrollStatus, isScrollLive, LOST_GRACE_MS, screensCount } from "@/lib/scrollProgress";

const STATUS_COLORS: Record<ScrollStatus, string> = {
	waiting: "text-white/65",
	capturing: "text-white/65",
	behind: "text-white/65",
	lost: "text-[#FFD60A]",
	full: "text-apple-green",
	finishing: "text-white/65",
	error: "text-[#FF6961]",
};

interface Preview {
	url: string;
	/** 预览图按面板宽度显示时比预览框还高：贴底显示最新拼上的部分。 */
	tall: boolean;
}

/**
 * 滚动截图的进度面板：贴在选区旁边，显示拼好的长图、长度和提示，以及取消 / 完成。
 * 窗口不可聚焦，被滚动的页面一直保有焦点；Esc / ↩ 由主进程处理。
 */
export function ScrollCapturePanel() {
	const api = window.electronAPI ?? mockScrollCaptureApi;
	const { t, locale } = useI18n();
	const text = t.capture.scroll;
	const [state, setState] = useState<ScrollCaptureState | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [lostSince, setLostSince] = useState<number | null>(null);
	const [, setTick] = useState(0);
	const previewBoxRef = useRef<HTMLDivElement>(null);
	const previewUrlRef = useRef<string | null>(null);

	useEffect(() => {
		let disposed = false;
		const sync = async () => {
			const next = await api.getScrollState();
			if (!disposed) setState(next);
		};
		void sync();
		const unsubscribe = api.onScrollChanged(() => void sync());
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [api]);

	// previewId 变了再拉取预览；旧的 Blob URL 换下来就释放
	const previewId = state?.previewId;
	useEffect(() => {
		if (previewId === undefined) return;
		let disposed = false;
		void api.getScrollPreview().then((bytes) => {
			if (disposed || !bytes) return;
			const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
			previewUrlRef.current = url;
			setPreview((current) => ({ url, tall: current?.tall ?? false }));
		});
		return () => {
			disposed = true;
		};
	}, [api, previewId]);

	useEffect(
		() => () => {
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
		},
		[],
	);

	// lost 持续一阵子才提示，到时间后重新渲染一次
	const status = state?.status ?? "waiting";
	useEffect(() => {
		if (status !== "lost") {
			setLostSince(null);
			return;
		}
		setLostSince(Date.now());
		const timer = window.setTimeout(() => setTick((tick) => tick + 1), LOST_GRACE_MS);
		return () => window.clearTimeout(timer);
	}, [status]);

	const finishing = status === "finishing";
	const canFinish = !finishing && status !== "error";
	const finish = () => {
		if (canFinish) void api.finishScroll();
	};
	const cancel = () => {
		if (!finishing) void api.cancelScroll();
	};

	// 窗口一般不会拿到焦点；dev:ui 下或被点到时也认 Esc / ↩
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") cancel();
			else if (event.key === "Enter") finish();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	const shownStatus = displayedScrollStatus(status, lostSince, Date.now());
	const height = state?.height ?? 0;
	const screens = screensCount(height, state?.frameHeight ?? 0);

	return (
		<div className="flex h-full w-full select-none p-2 text-white">
			<div className="flex min-h-0 w-full flex-col rounded-[18px] border border-white/10 bg-[#1C1C1E]/95 p-3 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<div className="drag flex items-center gap-1.5" title={text.dragHint}>
					<GripVertical size={12} className="shrink-0 text-white/35" aria-hidden="true" />
					<span
						aria-hidden="true"
						className={`h-2 w-2 shrink-0 rounded-full bg-apple-blue ${isScrollLive(status) ? "animate-pulse" : ""}`}
					/>
					<span className="min-w-0 flex-1 truncate text-[13px] font-bold">{text.title}</span>
					<span className="shrink-0 font-mono text-xs tabular-nums text-white/80">
						{height > 0 ? `${height.toLocaleString(locale)} px` : ""}
					</span>
				</div>
				<div className="mt-0.5 flex h-4 justify-between gap-2 pl-[18px] text-[10px] tabular-nums text-white/40">
					<span className="truncate">{text.dragHint}</span>
					<span className="shrink-0">{screens ? text.screens(screens) : ""}</span>
				</div>

				<div
					ref={previewBoxRef}
					className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/30"
				>
					{preview ? (
						<>
							<img
								src={preview.url}
								alt=""
								draggable={false}
								className={`absolute inset-x-0 w-full ${preview.tall ? "bottom-0" : "top-0"}`}
								onLoad={(event) => {
									const box = previewBoxRef.current;
									const image = event.currentTarget;
									if (!box || image.naturalWidth <= 0) return;
									const tall = (image.naturalHeight / image.naturalWidth) * box.clientWidth > box.clientHeight;
									setPreview((current) => (current && current.tall !== tall ? { ...current, tall } : current));
								}}
							/>
							{preview.tall && (
								<div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#1C1C1E]/70 to-transparent" />
							)}
						</>
					) : (
						<div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-white/40">
							{text.previewEmpty}
						</div>
					)}
				</div>

				<p role="status" className={`mt-2 min-h-[32px] text-[11px] font-medium leading-snug ${STATUS_COLORS[shownStatus]}`}>
					{text.status[shownStatus]}
				</p>

				<div className="mt-2 flex gap-2">
					<button
						type="button"
						disabled={finishing}
						className="no-drag flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-bold text-white/85 transition-all hover:bg-white/15 active:scale-95 disabled:opacity-40"
						onClick={cancel}
					>
						{text.cancel}
						<kbd className="font-sans text-[10px] font-medium text-white/45">esc</kbd>
					</button>
					<button
						type="button"
						disabled={!canFinish}
						className="no-drag flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-xs font-bold text-[#1C1C1E] transition-all hover:bg-white/90 active:scale-95 disabled:opacity-40"
						onClick={finish}
					>
						{text.finish}
						<CornerDownLeft size={12} strokeWidth={2.5} className="text-black/45" aria-label="Return" />
					</button>
				</div>
			</div>
		</div>
	);
}
