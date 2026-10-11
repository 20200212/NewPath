import { CircleAlert, Copy, Loader2, RotateCw, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/ToolButton";

interface OcrPanelProps {
	status: "idle" | "loading" | "done" | "error";
	text: string;
	error: string | null;
	onTextChange: (text: string) => void;
	onRetry: () => void;
	onCopy: () => void;
	onClose: () => void;
}

/** 右侧的提取文字面板：识别结果可以直接修改后复制。 */
export function OcrPanel({ status, text, error, onTextChange, onRetry, onCopy, onClose }: OcrPanelProps) {
	const lineCount = text ? text.split("\n").filter((line) => line.trim()).length : 0;
	return (
		<aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-gray-200/70 bg-white">
			<div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3">
				<ScanText size={16} strokeWidth={2.5} className="text-apple-blue" />
				<span className="text-sm font-black text-gray-800">提取文字</span>
				<button
					type="button"
					title="关闭"
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
						正在识别…
					</div>
				) : status === "error" ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center text-sm font-bold text-gray-500">
						<CircleAlert size={22} className="text-apple-red" />
						<span>{error ?? "文字识别失败"}</span>
						<ChipButton onClick={onRetry}>
							<RotateCw size={14} strokeWidth={2.5} />
							重试
						</ChipButton>
					</div>
				) : !text ? (
					<div className="flex flex-1 items-center justify-center text-sm font-bold text-gray-400">没有识别到文字</div>
				) : (
					<>
						<textarea
							value={text}
							spellCheck={false}
							className="min-h-0 flex-1 resize-none rounded-xl border border-gray-200 bg-apple-bg/50 p-3 text-sm leading-relaxed text-gray-800 outline-none focus:border-apple-blue/50"
							onChange={(event) => onTextChange(event.target.value)}
						/>
						<span className="mt-2 text-xs font-bold text-gray-400">共 {lineCount} 行</span>
					</>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-3 py-3">
				<ChipButton disabled={status === "loading"} onClick={onRetry}>
					<RotateCw size={14} strokeWidth={2.5} />
					重新识别
				</ChipButton>
				<Button size="sm" disabled={!text || status !== "done"} onClick={onCopy}>
					<Copy size={15} strokeWidth={2.5} />
					复制文字
				</Button>
			</div>
		</aside>
	);
}
