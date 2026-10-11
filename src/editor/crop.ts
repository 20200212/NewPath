import { boxesIntersect, getVisualBounds, moveAnnotation, type Handle } from "./geometry";
import type { Annotation, Point, Rect, Size } from "./types";

/** 新的裁剪框是相对于已裁剪过的图片的，叠加到原来的裁剪上。 */
export function combineCrops(previous: Rect | null, next: Rect): Rect {
	if (!previous) return next;
	return { x: previous.x + next.x, y: previous.y + next.y, width: next.width, height: next.height };
}

/** 裁剪后：完全落在框外的标注删掉，其余平移到新坐标（部分在外的保留，绘制时自然被裁掉）。 */
export function cropAnnotations(annotations: readonly Annotation[], crop: Rect): Annotation[] {
	const area = { x: crop.x, y: crop.y, w: crop.width, h: crop.height };
	return annotations
		.filter((annotation) => boxesIntersect(getVisualBounds(annotation), area))
		.map((annotation) => moveAnnotation(annotation, -crop.x, -crop.y));
}

/** 取整并限制在图片内；太小或等于整张图时返回 null（不需要裁剪）。 */
export function normalizeCrop(rect: Rect, image: Size): Rect | null {
	const left = Math.max(0, Math.round(rect.x));
	const top = Math.max(0, Math.round(rect.y));
	const right = Math.min(image.width, Math.round(rect.x + rect.width));
	const bottom = Math.min(image.height, Math.round(rect.y + rect.height));
	if (right - left < 1 || bottom - top < 1) return null;
	if (left === 0 && top === 0 && right === image.width && bottom === image.height) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export type CropHit = Handle | "move";

/** 裁剪框上光标所在的位置：靠近边或角时调整大小，框内移动，框外返回 null（重新框选）。 */
export function cropHitAt(rect: Rect, point: Point, tolerance: number): CropHit | null {
	const { x, y, width, height } = rect;
	const withinX = point.x >= x - tolerance && point.x <= x + width + tolerance;
	const withinY = point.y >= y - tolerance && point.y <= y + height + tolerance;
	if (!withinX || !withinY) return null;
	const north = Math.abs(point.y - y) <= tolerance;
	const south = !north && Math.abs(point.y - (y + height)) <= tolerance;
	const west = Math.abs(point.x - x) <= tolerance;
	const east = !west && Math.abs(point.x - (x + width)) <= tolerance;
	const vertical = north ? "n" : south ? "s" : "";
	const horizontal = west ? "w" : east ? "e" : "";
	if (vertical || horizontal) return `${vertical}${horizontal}` as Handle;
	return "move";
}
