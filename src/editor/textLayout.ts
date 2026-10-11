import type { TextStyle } from "./types";

/** 画布上的文字和编辑时的文本框必须用同一套字体参数，否则编辑完位置会跳。 */
export const TEXT_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
export const TEXT_FONT_WEIGHT = 600;
export const TEXT_LINE_HEIGHT = 1.3;

export function textFont(size: number): string {
	return `${TEXT_FONT_WEIGHT} ${size}px ${TEXT_FONT_FAMILY}`;
}

/** 不同样式的内边距：底色样式要留出圆角背景的空间。 */
export function textPadding(size: number, style: TextStyle): { x: number; y: number } {
	switch (style) {
		case "pill":
			return { x: size * 0.5, y: size * 0.25 };
		case "outline":
			return { x: size * 0.2, y: size * 0.1 };
		case "plain":
			return { x: size * 0.1, y: size * 0.05 };
	}
}

let measureContext: CanvasRenderingContext2D | null = null;
const cache = new Map<string, { w: number; h: number }>();
const CACHE_LIMIT = 500;

/** 测量文字标注的外框（含内边距），多行按最宽的一行。 */
export function measureText(text: string, size: number, style: TextStyle): { w: number; h: number } {
	const key = `${size}|${style}|${text}`;
	const cached = cache.get(key);
	if (cached) return cached;
	measureContext ??= document.createElement("canvas").getContext("2d");
	const lines = text.split("\n");
	let width = 0;
	if (measureContext) {
		measureContext.font = textFont(size);
		for (const line of lines) width = Math.max(width, measureContext.measureText(line).width);
	} else {
		width = Math.max(...lines.map((line) => line.length)) * size * 0.6;
	}
	const padding = textPadding(size, style);
	const result = { w: width + padding.x * 2, h: lines.length * size * TEXT_LINE_HEIGHT + padding.y * 2 };
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(key, result);
	return result;
}
