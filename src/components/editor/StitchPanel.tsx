import { ChevronDown, ChevronUp, ImagePlus, Trash2 } from "lucide-react";
import { ChipButton, ToolButton } from "@/components/ui/ToolButton";
import { MAX_STITCH_GAP } from "@/editor/stitch";
import { useI18n } from "@/i18n";

interface StitchPanelProps {
	pieces: { id: string; width: number; height: number; src: string }[];
	gap: number;
	onMove: (index: number, delta: number) => void;
	onRemove: (index: number) => void;
	onGapChange: (gap: number) => void;
	onAdd: () => void;
}

/** 拼接面板：调整顺序、删除某一张、修改间距。 */
export function StitchPanel({ pieces, gap, onMove, onRemove, onGapChange, onAdd }: StitchPanelProps) {
	const { t } = useI18n();
	const text = t.editor.stitch;
	return (
		<section className="shrink-0 border-b border-gray-200/70 bg-white p-3">
			<div className="mb-2 flex items-center gap-2 px-1">
				<span className="text-sm font-black text-gray-800">{text.title}</span>
				<span className="rounded-md bg-gray-100 px-1.5 text-xs font-bold text-gray-500">{pieces.length}</span>
			</div>

			<ul className="max-h-64 space-y-1 overflow-y-auto">
				{pieces.map((piece, index) => (
					<li key={piece.id} className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-gray-50">
						<img src={piece.src} alt="" draggable={false} className="h-8 w-12 shrink-0 rounded-md border border-gray-200 object-cover" />
						<div className="min-w-0 flex-1">
							<div className="text-xs font-bold text-gray-700">{text.piece(index + 1)}</div>
							<div className="font-mono text-[11px] text-gray-400">
								{piece.width} × {piece.height}
							</div>
						</div>
						<ToolButton icon={ChevronUp} label={text.moveUp} className="h-7 w-7" disabled={index === 0} onClick={() => onMove(index, -1)} />
						<ToolButton
							icon={ChevronDown}
							label={text.moveDown}
							className="h-7 w-7"
							disabled={index === pieces.length - 1}
							onClick={() => onMove(index, 1)}
						/>
						<ToolButton
							icon={Trash2}
							label={text.remove}
							className="h-7 w-7 hover:!bg-red-50 hover:!text-apple-red"
							disabled={pieces.length <= 1}
							onClick={() => onRemove(index)}
						/>
					</li>
				))}
			</ul>

			<label className="mt-3 flex items-center gap-2 px-1 text-xs font-bold text-gray-500">
				{text.gap}
				<input
					type="range"
					min={0}
					max={MAX_STITCH_GAP}
					value={gap}
					className="h-1 flex-1 cursor-pointer accent-apple-blue"
					onChange={(event) => onGapChange(Number(event.target.value))}
				/>
				<span className="w-10 text-right font-mono text-gray-400">{gap}px</span>
			</label>

			<ChipButton className="mt-2 w-full" onClick={onAdd}>
				<ImagePlus size={14} strokeWidth={2.5} />
				{text.addMore}
			</ChipButton>
		</section>
	);
}
