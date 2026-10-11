import { CopyPlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { ChipButton, ToolButton } from "@/components/ui/ToolButton";
import { PALETTE } from "@/editor/presets";
import type { AnnotationKind, ShapeFill, SizeLevel, TextSizeLevel, TextStyle, ToolStyle } from "@/editor/types";
import { useI18n } from "@/i18n";
import { appShortcut } from "@/lib/platform";

interface StyleBarProps {
	/** 当前工具，或选中标注的类型。 */
	kind: AnnotationKind;
	style: ToolStyle;
	onChange: (patch: Partial<ToolStyle>) => void;
	hasSelection: boolean;
	onDuplicate: () => void;
	onDelete: () => void;
	smartRedactAvailable: boolean;
	smartRedactBusy: boolean;
	onSmartRedact: () => void;
}

const DOT_SIZES = [4, 7, 10];
const TEXT_SIZE_PREVIEW = [11, 13, 15, 18];
const TEXT_STYLES: readonly TextStyle[] = ["plain", "pill", "outline"];
const FILLS: readonly ShapeFill[] = ["none", "soft", "solid"];

function Divider() {
	return <div className="mx-1 h-6 w-px shrink-0 bg-gray-200" />;
}

/** 浮在画布顶部的样式条，内容随工具或选中标注的类型变化。 */
export function StyleBar({
	kind,
	style,
	onChange,
	hasSelection,
	onDuplicate,
	onDelete,
	smartRedactAvailable,
	smartRedactBusy,
	onSmartRedact,
}: StyleBarProps) {
	const { t } = useI18n();
	const text = t.editor.style;
	const isRedact = kind === "redact";
	const isText = kind === "text";
	const customColor = !PALETTE.includes(style.color.toUpperCase()) && !PALETTE.includes(style.color);

	return (
		<div
			data-no-wheel
			className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-gray-200/80 bg-white/95 p-1.5 shadow-card backdrop-blur-xl"
		>
			{!isRedact && (
				<>
					<div className="flex items-center gap-1 px-1">
						{PALETTE.map((color) => {
							const active = style.color.toUpperCase() === color.toUpperCase();
							return (
								<button
									key={color}
									type="button"
									title={color}
									className={`h-[22px] w-[22px] shrink-0 rounded-full border border-black/10 transition-transform hover:scale-110 active:scale-95 ${
										active ? "ring-2 ring-apple-blue ring-offset-2" : ""
									}`}
									style={{ backgroundColor: color }}
									onClick={() => onChange({ color })}
								/>
							);
						})}
						<label
							title={text.customColor}
							className={`relative h-[22px] w-[22px] shrink-0 cursor-pointer rounded-full border border-black/10 transition-transform hover:scale-110 ${
								customColor ? "ring-2 ring-apple-blue ring-offset-2" : ""
							}`}
							style={{
								background: "conic-gradient(#FF3B30, #FFCC00, #34C759, #00C7BE, #007AFF, #AF52DE, #FF2D55, #FF3B30)",
							}}
						>
							<input
								type="color"
								value={style.color}
								className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
								onChange={(event) => onChange({ color: event.target.value.toUpperCase() })}
							/>
						</label>
					</div>
					<Divider />
				</>
			)}

			{isRedact && (
				<>
					<ChipButton active={style.redactMode === "pixelate"} onClick={() => onChange({ redactMode: "pixelate" })}>
						{text.pixelate}
					</ChipButton>
					<ChipButton active={style.redactMode === "blur"} onClick={() => onChange({ redactMode: "blur" })}>
						{text.blur}
					</ChipButton>
					<Divider />
				</>
			)}

			{isText ? (
				<>
					{TEXT_SIZE_PREVIEW.map((size, level) => (
						<ChipButton
							key={size}
							title={text.textSizeTitle(level + 1)}
							className="w-8 px-0"
							active={style.textSize === level}
							onClick={() => onChange({ textSize: level as TextSizeLevel })}
						>
							<span style={{ fontSize: size }}>A</span>
						</ChipButton>
					))}
					<Divider />
					{TEXT_STYLES.map((value) => (
						<ChipButton
							key={value}
							className="whitespace-nowrap"
							active={style.textStyle === value}
							onClick={() => onChange({ textStyle: value })}
						>
							{text.textStyles[value]}
						</ChipButton>
					))}
				</>
			) : (
				DOT_SIZES.map((size, level) => (
					<ChipButton
						key={size}
						title={text.sizeTitle(text.sizes[level])}
						className="w-8 px-0"
						active={style.strokeSize === level}
						onClick={() => onChange({ strokeSize: level as SizeLevel })}
					>
						<span className="rounded-full bg-current" style={{ width: size, height: size }} />
					</ChipButton>
				))
			)}

			{(kind === "rect" || kind === "ellipse") && (
				<>
					<Divider />
					{FILLS.map((value) => (
						<ChipButton key={value} className="whitespace-nowrap" active={style.fill === value} onClick={() => onChange({ fill: value })}>
							{text.fills[value]}
						</ChipButton>
					))}
				</>
			)}

			{isRedact && smartRedactAvailable && (
				<>
					<Divider />
					<ChipButton title={text.smartRedactTitle(appShortcut("Ctrl+Shift+M"))} className="whitespace-nowrap" disabled={smartRedactBusy} onClick={onSmartRedact}>
						{smartRedactBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} strokeWidth={2.5} />}
						{text.smartRedact}
					</ChipButton>
				</>
			)}

			{hasSelection && (
				<>
					<Divider />
					<ToolButton icon={CopyPlus} label={text.duplicate} shortcut="Ctrl+D" onClick={onDuplicate} />
					<ToolButton icon={Trash2} label={text.delete} shortcut="Delete" className="hover:!bg-red-50 hover:!text-apple-red" onClick={onDelete} />
				</>
			)}
		</div>
	);
}
