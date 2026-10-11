import { drawAnnotations, RedactCache } from "./renderAnnotations";
import type { StitchLayout } from "./stitch";
import type { Annotation, Rect } from "./types";

/** 拼接时间隙和窄图两侧的底色。 */
const STITCH_BACKGROUND = "#FFFFFF";

/** 加载图片并等待解码完成。 */
export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("图片加载失败"));
		image.src = src;
	});
}

function createCanvas(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	return canvas;
}

/** 按拼接布局把所有图片画到一张 canvas 上，再按裁剪区域截取，得到编辑器的"源图"。 */
export function buildSourceCanvas(
	layout: StitchLayout,
	images: ReadonlyMap<string, CanvasImageSource>,
	crop: Rect | null,
): HTMLCanvasElement {
	const area = crop ?? { x: 0, y: 0, width: layout.width, height: layout.height };
	const canvas = createCanvas(area.width, area.height);
	const ctx = canvas.getContext("2d")!;
	if (layout.placements.length > 1) {
		ctx.fillStyle = STITCH_BACKGROUND;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	for (const placement of layout.placements) {
		const image = images.get(placement.id);
		if (image) ctx.drawImage(image, placement.x - area.x, placement.y - area.y, placement.width, placement.height);
	}
	return canvas;
}

/**
 * 把源图和标注合成为最终图片。maxSide 限制最长边（钉图用），默认按原始分辨率导出。
 * 与屏幕显示使用同一个 drawAnnotations，导出结果和看到的一致。
 */
export function renderDocument(
	source: HTMLCanvasElement,
	annotations: readonly Annotation[],
	sourceKey: string,
	maxSide = Infinity,
): HTMLCanvasElement {
	const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
	const canvas = createCanvas(source.width * scale, source.height * scale);
	const ctx = canvas.getContext("2d")!;
	ctx.scale(scale, scale);
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(source, 0, 0);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, source.width, source.height);
	ctx.clip();
	drawAnnotations(ctx, annotations, { source, sourceKey, pixelScale: scale, cache: new RedactCache() });
	ctx.restore();
	return canvas;
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出失败"))), "image/png"),
	);
	return new Uint8Array(await blob.arrayBuffer());
}
