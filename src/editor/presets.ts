import type { Annotation, AnnotationKind, RedactMode, SizeLevel, TextSizeLevel, TextStyle, ToolStyle } from "./types";

/** 色板：红、橙、黄、绿、蓝、紫、白、黑。 */
export const PALETTE = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE", "#FFFFFF", "#1C1C1E"];

/**
 * 三档尺寸（单位：逻辑像素）。实际像素再乘以 unit（截图的缩放比例），
 * 这样在 1x 和 2x 屏幕的截图上标注看起来一样粗。
 */
const STROKE_WIDTHS = [2, 4, 7];
const HIGHLIGHTER_WIDTHS = [10, 16, 24];
const COUNTER_RADII = [10, 13, 17];
const PIXELATE_BLOCKS = [6, 10, 16];
const BLUR_RADII = [5, 10, 18];
const TEXT_SIZES = [14, 20, 28, 40];

export const DEFAULT_STYLE: ToolStyle = {
	color: "#FF3B30",
	strokeSize: 1,
	fill: "none",
	textSize: 1,
	textStyle: "plain",
	redactMode: "pixelate",
};

/** devicePixelRatio 限制在 1–4。 */
export function clampUnit(ratio: number): number {
	return Number.isFinite(ratio) ? Math.min(4, Math.max(1, ratio)) : 1;
}

export function strokeWidthFor(kind: AnnotationKind, level: SizeLevel, unit: number): number {
	return (kind === "highlighter" ? HIGHLIGHTER_WIDTHS : STROKE_WIDTHS)[level] * unit;
}

export function counterRadiusFor(level: SizeLevel, unit: number): number {
	return COUNTER_RADII[level] * unit;
}

export function redactStrengthFor(mode: RedactMode, level: SizeLevel, unit: number): number {
	return (mode === "pixelate" ? PIXELATE_BLOCKS : BLUR_RADII)[level] * unit;
}

export function textSizeFor(level: TextSizeLevel, unit: number): number {
	return TEXT_SIZES[level] * unit;
}

/** 离 value 最近的一档。 */
function nearestLevel(values: number[], value: number): number {
	let best = 0;
	values.forEach((candidate, index) => {
		if (Math.abs(candidate - value) < Math.abs(values[best] - value)) best = index;
	});
	return best;
}

/** 选中标注时，把它的样式映射回样式条上的选项。 */
export function styleFromAnnotation(annotation: Annotation, unit: number): Partial<ToolStyle> {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
			return {
				color: annotation.color,
				fill: annotation.fill,
				strokeSize: nearestLevel(STROKE_WIDTHS, annotation.width / unit) as SizeLevel,
			};
		case "arrow":
		case "line":
		case "pen":
			return { color: annotation.color, strokeSize: nearestLevel(STROKE_WIDTHS, annotation.width / unit) as SizeLevel };
		case "highlighter":
			return { color: annotation.color, strokeSize: nearestLevel(HIGHLIGHTER_WIDTHS, annotation.width / unit) as SizeLevel };
		case "counter":
			return { color: annotation.color, strokeSize: nearestLevel(COUNTER_RADII, annotation.size / unit) as SizeLevel };
		case "text":
			return {
				color: annotation.color,
				textStyle: annotation.style,
				textSize: nearestLevel(TEXT_SIZES, annotation.size / unit) as TextSizeLevel,
			};
		case "redact": {
			const values = annotation.mode === "pixelate" ? PIXELATE_BLOCKS : BLUR_RADII;
			return { redactMode: annotation.mode, strokeSize: nearestLevel(values, annotation.strength / unit) as SizeLevel };
		}
	}
}

export type MeasureText = (text: string, size: number, style: TextStyle) => { w: number; h: number };

/** 把样式条上的修改应用到一个标注上，只改 patch 里出现、且对这种标注有意义的属性。 */
export function restyleAnnotation(
	annotation: Annotation,
	patch: Partial<ToolStyle>,
	unit: number,
	measure: MeasureText,
): Annotation {
	const color = patch.color;
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
			return {
				...annotation,
				color: color ?? annotation.color,
				fill: patch.fill ?? annotation.fill,
				width: patch.strokeSize === undefined ? annotation.width : strokeWidthFor(annotation.kind, patch.strokeSize, unit),
			};
		case "arrow":
		case "line":
		case "pen":
		case "highlighter":
			return {
				...annotation,
				color: color ?? annotation.color,
				width: patch.strokeSize === undefined ? annotation.width : strokeWidthFor(annotation.kind, patch.strokeSize, unit),
			};
		case "counter":
			return {
				...annotation,
				color: color ?? annotation.color,
				size: patch.strokeSize === undefined ? annotation.size : counterRadiusFor(patch.strokeSize, unit),
			};
		case "text": {
			const size = patch.textSize === undefined ? annotation.size : textSizeFor(patch.textSize, unit);
			const style = patch.textStyle ?? annotation.style;
			const box = size === annotation.size && style === annotation.style ? annotation : measure(annotation.text, size, style);
			return { ...annotation, color: color ?? annotation.color, size, style, w: box.w, h: box.h };
		}
		case "redact": {
			const mode = patch.redactMode ?? annotation.mode;
			const level = patch.strokeSize ?? (styleFromAnnotation(annotation, unit).strokeSize as SizeLevel);
			const changed = patch.redactMode !== undefined || patch.strokeSize !== undefined;
			return { ...annotation, mode, strength: changed ? redactStrengthFor(mode, level, unit) : annotation.strength };
		}
	}
}

/** [ / ] 快捷键：文字调字号，其他调粗细。 */
export function stepSize(style: ToolStyle, kind: AnnotationKind, delta: number): Partial<ToolStyle> {
	if (kind === "text") return { textSize: Math.min(3, Math.max(0, style.textSize + delta)) as TextSizeLevel };
	return { strokeSize: Math.min(2, Math.max(0, style.strokeSize + delta)) as SizeLevel };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 读取 localStorage 里保存的样式，不合法的字段用默认值。 */
export function sanitizeStyle(raw: unknown): ToolStyle {
	const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
		allowed.includes(candidate as T) ? (candidate as T) : fallback;
	return {
		color: typeof value.color === "string" && HEX_COLOR.test(value.color) ? value.color : DEFAULT_STYLE.color,
		strokeSize: pick(value.strokeSize, [0, 1, 2] as const, DEFAULT_STYLE.strokeSize),
		fill: pick(value.fill, ["none", "soft", "solid"] as const, DEFAULT_STYLE.fill),
		textSize: pick(value.textSize, [0, 1, 2, 3] as const, DEFAULT_STYLE.textSize),
		textStyle: pick(value.textStyle, ["plain", "pill", "outline"] as const, DEFAULT_STYLE.textStyle),
		redactMode: pick(value.redactMode, ["pixelate", "blur"] as const, DEFAULT_STYLE.redactMode),
	};
}

function parseHex(hex: string): [number, number, number] {
	const value = HEX_COLOR.test(hex) ? hex.slice(1) : "000000";
	return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function withAlpha(hex: string, alpha: number): string {
	const [r, g, b] = parseHex(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 在这个颜色上写字用黑还是白（按感知亮度）。 */
export function contrastColor(hex: string): string {
	const [r, g, b] = parseHex(hex);
	return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#1C1C1E" : "#FFFFFF";
}
