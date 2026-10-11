import type { OcrLine, OcrWord } from "./ipcTypes";

/** 中日韩文字和全角标点：它们之间不加空格，计算字符位置时按两个字宽算。 */
const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

export function isCjk(char: string): boolean {
	return CJK.test(char);
}

export function charWeight(char: string): number {
	return isCjk(char) ? 2 : 1;
}

/** 一个词在整行文本里的位置。 */
export interface LineSegment {
	word: OcrWord;
	start: number;
	end: number;
}

/**
 * 把一行里的词拼成文本，同时记录每个词对应的字符区间。
 * Windows OCR 把中文拆成单字，所以只在两侧都不是中文时才补空格。
 */
export function layoutLine(words: OcrWord[]): { text: string; segments: LineSegment[] } {
	let text = "";
	const segments: LineSegment[] = [];
	for (const word of words) {
		if (!word.text) continue;
		if (text && !isCjk(text[text.length - 1]) && !isCjk(word.text[0])) text += " ";
		segments.push({ word, start: text.length, end: text.length + word.text.length });
		text += word.text;
	}
	return { text, segments };
}

/** 识别时图片先按 scale 缩放，再纵向切成若干块；offsetY 是每块在缩放后图片里的位置。 */
export interface OcrTile {
	offsetY: number;
	height: number;
}

/** 文字越大识别越准：小图先放大一倍；同时不能超过 OCR 引擎的最大边长。 */
export function pickOcrScale(size: { width: number; height: number }, maxDimension = 10000): number {
	const upscale = size.width * size.height <= 4_000_000 ? 2 : 1;
	return Math.min(upscale, maxDimension / size.width);
}

/** 纵向切块，避免超长的拼接图超出引擎限制。 */
export function planOcrTiles(height: number, tileHeight = 4000): OcrTile[] {
	const tiles: OcrTile[] = [];
	for (let offsetY = 0; offsetY < height; offsetY += tileHeight) {
		tiles.push({ offsetY, height: Math.min(tileHeight, height - offsetY) });
	}
	return tiles;
}

export type ParsedOcr = { ok: true; lines: OcrLine[] } | { ok: false; error: string };

function toNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** PowerShell 的 ConvertTo-Json 遇到单元素数组可能输出成对象，统一当数组处理。 */
function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	return value && typeof value === "object" ? [value] : [];
}

/**
 * 解析识别脚本的输出 { pages: [{ lines: [{ words: [{ text, x, y, w, h }] }] }] }，
 * 每页对应一个切块；坐标换算回原图像素。
 */
export function parseOcrOutput(json: string, tiles: OcrTile[], scale: number): ParsedOcr {
	let data: unknown;
	try {
		data = JSON.parse(json.trim());
	} catch {
		return { ok: false, error: "invalid-output" };
	}
	if (!data || typeof data !== "object") return { ok: false, error: "invalid-output" };
	const record = data as Record<string, unknown>;
	if (typeof record.error === "string") return { ok: false, error: record.error };

	const lines: OcrLine[] = [];
	asArray(record.pages).forEach((page, index) => {
		const tile = tiles[index];
		if (!tile || !page || typeof page !== "object") return;
		for (const rawLine of asArray((page as Record<string, unknown>).lines)) {
			if (!rawLine || typeof rawLine !== "object") continue;
			const words: OcrWord[] = [];
			for (const rawWord of asArray((rawLine as Record<string, unknown>).words)) {
				if (!rawWord || typeof rawWord !== "object") continue;
				const item = rawWord as Record<string, unknown>;
				const [x, y, w, h] = [toNumber(item.x), toNumber(item.y), toNumber(item.w), toNumber(item.h)];
				if (typeof item.text !== "string" || x === null || y === null || w === null || h === null) continue;
				words.push({
					text: item.text,
					x: x / scale,
					y: (y + tile.offsetY) / scale,
					width: w / scale,
					height: h / scale,
				});
			}
			const { text } = layoutLine(words);
			if (text) lines.push({ text, words });
		}
	});
	return { ok: true, lines };
}
