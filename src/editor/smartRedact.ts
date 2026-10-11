import type { SensitiveKind, SensitiveRegion } from "../../electron/ipcTypes";
import type { Annotation, RedactAnnotation, RedactMode } from "./types";

/** 已经被现有打码盖住这么多比例的区域不再重复打码，连续点两次智能打码不会叠加。 */
const COVERED_RATIO = 0.8;

function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
	const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

/**
 * 把识别出的敏感区域转成打码标注。
 * 打码强度至少是区域高度的 0.3 倍，保证大字号也看不出来。
 */
export function regionsToRedactions(
	regions: readonly SensitiveRegion[],
	existing: readonly Annotation[],
	mode: RedactMode,
	strength: number,
	makeId: () => string,
): RedactAnnotation[] {
	const redacts = existing.filter((annotation): annotation is RedactAnnotation => annotation.kind === "redact");
	const result: RedactAnnotation[] = [];
	for (const region of regions) {
		const box = { x: region.x, y: region.y, w: region.width, h: region.height };
		const area = box.w * box.h;
		if (area <= 0) continue;
		const covered = [...redacts, ...result].reduce((sum, redact) => sum + overlapArea(box, redact), 0);
		if (covered / area >= COVERED_RATIO) continue;
		result.push({
			id: makeId(),
			kind: "redact",
			...box,
			mode,
			strength: Math.max(strength, Math.round(box.h * 0.3)),
		});
	}
	return result;
}

/**
 * 提示里列出找到了哪些类型，例如"邮箱、IP 地址"。
 * 类型名称和分隔符由调用方按界面语言传入（中文用"、"，英文用", "）。
 */
export function describeKinds(
	regions: readonly SensitiveRegion[],
	labels: Readonly<Record<SensitiveKind, string>>,
	separator: string,
): string {
	return [...new Set(regions.map((region) => labels[region.kind]))].join(separator);
}
