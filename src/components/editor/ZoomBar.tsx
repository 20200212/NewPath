import { Hand, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ChipButton, ToolButton } from "@/components/ui/ToolButton";
import { formatZoom, MAX_ZOOM, MIN_ZOOM, parseZoomInput } from "@/editor/viewport";

interface ZoomBarProps {
	width: number;
	height: number;
	zoom: number;
	fitting: boolean;
	handMode: boolean;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onSetZoom: (zoom: number) => void;
	onActualSize: () => void;
	onFit: () => void;
	onToggleHand: () => void;
}

function Divider() {
	return <div className="mx-1 h-5 w-px shrink-0 bg-gray-200" />;
}

/** 画布底部的缩放条，上方显示图片尺寸。 */
export function ZoomBar(props: ZoomBarProps) {
	const { zoom } = props;
	const [draft, setDraft] = useState<string | null>(null);

	// 缩放变化时丢弃没有提交的输入
	useEffect(() => setDraft(null), [zoom]);

	const apply = () => {
		if (draft === null) return;
		const next = parseZoomInput(draft);
		setDraft(null);
		if (next !== null) props.onSetZoom(next);
	};

	return (
		<div data-no-wheel className="pointer-events-auto flex flex-col items-center gap-1">
			<span className="font-mono text-[11px] font-bold text-gray-400">
				{props.width} × {props.height}
			</span>
			<div className="flex items-center gap-0.5 rounded-2xl border border-gray-200/80 bg-white p-1 shadow-card">
				<ToolButton icon={Minus} label="缩小" shortcut="Ctrl+-" disabled={zoom <= MIN_ZOOM} onClick={props.onZoomOut} />
				<div className="flex items-center">
					<input
						value={draft ?? formatZoom(zoom)}
						aria-label="缩放比例"
						className="w-14 rounded-lg bg-transparent py-1 text-center font-mono text-xs font-bold text-gray-700 outline-none focus:bg-apple-bg"
						onFocus={(event) => {
							setDraft(formatZoom(zoom));
							event.currentTarget.select();
						}}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={apply}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
							else if (event.key === "Escape") {
								event.stopPropagation();
								setDraft(null);
								// 先清空草稿再失焦，onBlur 时不会应用
								requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
							}
						}}
					/>
					<span className="pr-1 text-xs font-bold text-gray-400">%</span>
				</div>
				<ToolButton icon={Plus} label="放大" shortcut="Ctrl+=" disabled={zoom >= MAX_ZOOM} onClick={props.onZoomIn} />
				<Divider />
				<ChipButton title="原始大小（Ctrl+0）" active={Math.abs(zoom - 1) < 0.001} onClick={props.onActualSize}>
					100%
				</ChipButton>
				<ChipButton title="适应窗口（Ctrl+9）" active={props.fitting} onClick={props.onFit}>
					适应窗口
				</ChipButton>
				<Divider />
				<ToolButton icon={Hand} label="抓手（按住空格临时使用）" active={props.handMode} onClick={props.onToggleHand} />
			</div>
		</div>
	);
}
