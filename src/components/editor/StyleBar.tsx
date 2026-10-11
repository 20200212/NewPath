import { CopyPlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { ChipButton, ToolButton } from "@/components/ui/ToolButton";
import { PALETTE } from "@/editor/presets";
import type { AnnotationKind, ShapeFill, SizeLevel, TextSizeLevel, TextStyle, ToolStyle } from "@/editor/types";

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
const SIZE_LABELS = ["小", "中", "大"];
const TEXT_SIZE_PREVIEW = [11, 13, 15, 18];
const TEXT_STYLES: { value: TextStyle; label: string }[] = [
	{ value: "plain", label: "普通" },
	{ value: "pill", label: "底色" },
	{ value: "outline", label: "描边" },
];
const FILLS: { value: ShapeFill; label: string }[] = [
	{ value: "none", label: "描边" },
	{ value: "soft", label: "浅填充" },
	{ value: "solid", label: "实心" },
];

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
							title="自定义颜色"
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
						像素化
					</ChipButton>
					<ChipButton active={style.redactMode === "blur"} onClick={() => onChange({ redactMode: "blur" })}>
						模糊
					</ChipButton>
					<Divider />
				</>
			)}

			{isText ? (
				<>
					{TEXT_SIZE_PREVIEW.map((size, level) => (
						<ChipButton
							key={size}
							title={`字号 ${level + 1}（[ / ] 调整）`}
							className="w-8 px-0"
							active={style.textSize === level}
							onClick={() => onChange({ textSize: level as TextSizeLevel })}
						>
							<span style={{ fontSize: size }}>A</span>
						</ChipButton>
					))}
					<Divider />
					{TEXT_STYLES.map((item) => (
						<ChipButton key={item.value} active={style.textStyle === item.value} onClick={() => onChange({ textStyle: item.value })}>
							{item.label}
						</ChipButton>
					))}
				</>
			) : (
				DOT_SIZES.map((size, level) => (
					<ChipButton
						key={size}
						title={`${SIZE_LABELS[level]}（[ / ] 调整）`}
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
					{FILLS.map((item) => (
						<ChipButton key={item.value} active={style.fill === item.value} onClick={() => onChange({ fill: item.value })}>
							{item.label}
						</ChipButton>
					))}
				</>
			)}

			{isRedact && smartRedactAvailable && (
				<>
					<Divider />
					<ChipButton title="识别并遮住邮箱、IP、密钥等（Ctrl+Shift+M）" disabled={smartRedactBusy} onClick={onSmartRedact}>
						{smartRedactBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} strokeWidth={2.5} />}
						智能打码
					</ChipButton>
				</>
			)}

			{hasSelection && (
				<>
					<Divider />
					<ToolButton icon={CopyPlus} label="复制一份" shortcut="Ctrl+D" onClick={onDuplicate} />
					<ToolButton icon={Trash2} label="删除" shortcut="Delete" className="hover:!bg-red-50 hover:!text-apple-red" onClick={onDelete} />
				</>
			)}
		</div>
	);
}
