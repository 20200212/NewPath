/**
 * 滚动截图面板的预览图：把目前拼好的长图（从上到下的若干段 BGRA 行）缩到面板宽度，
 * 太长时只保留最新（最下面）的部分。对应 macOS 截图进程 ScrollCapture.swift 里的 writePreview。
 */

export interface PixelSegment {
	pixels: Uint8Array;
	rows: number;
}

export interface PreviewBitmap {
	width: number;
	height: number;
	/** BGRA，每行 width * 4 字节。 */
	pixels: Uint8Array;
}

export const PREVIEW_MAX_WIDTH = 432;
export const PREVIEW_MAX_HEIGHT = 640;

/**
 * 面积平均缩放：输出每个像素取覆盖到的源像素的平均值，缩小时没有锯齿。不放大（scale 最大为 1）。
 * 返回 null 表示还没有内容。
 */
export function composePreview(
	segments: readonly PixelSegment[],
	width: number,
	maxWidth = PREVIEW_MAX_WIDTH,
	maxHeight = PREVIEW_MAX_HEIGHT,
): PreviewBitmap | null {
	const total = segments.reduce((sum, segment) => sum + segment.rows, 0);
	if (width <= 0 || total <= 0) return null;
	const scale = Math.min(1, maxWidth / width);
	const targetWidth = Math.max(1, Math.round(width * scale));
	const targetHeight = Math.max(1, Math.min(maxHeight, Math.round(total * scale)));
	// 只保留最新的部分：输出的最后一行对应长图的最后一行
	const sourceRows = targetHeight / scale;
	const sourceStart = total - sourceRows;
	const rowBytes = width * 4;
	const output = new Uint8Array(targetWidth * targetHeight * 4);

	// 把分段拼成"第几行在哪一段的哪个偏移"
	const starts: number[] = [];
	let above = 0;
	for (const segment of segments) {
		starts.push(above);
		above += segment.rows;
	}
	const rowAt = (row: number): { pixels: Uint8Array; offset: number } => {
		let index = starts.length - 1;
		while (index > 0 && starts[index] > row) index -= 1;
		return { pixels: segments[index].pixels, offset: (row - starts[index]) * rowBytes };
	};

	const sums = new Float64Array(targetWidth * 4);
	const weights = new Float64Array(targetWidth);
	for (let oy = 0; oy < targetHeight; oy += 1) {
		sums.fill(0);
		weights.fill(0);
		const y0 = sourceStart + oy / scale;
		const y1 = sourceStart + (oy + 1) / scale;
		const firstRow = Math.max(0, Math.floor(y0));
		const lastRow = Math.min(total - 1, Math.ceil(y1) - 1);
		for (let sy = firstRow; sy <= lastRow; sy += 1) {
			const rowWeight = Math.min(sy + 1, y1) - Math.max(sy, y0);
			if (rowWeight <= 0) continue;
			const { pixels, offset } = rowAt(sy);
			for (let ox = 0; ox < targetWidth; ox += 1) {
				const x0 = ox / scale;
				const x1 = (ox + 1) / scale;
				const firstColumn = Math.floor(x0);
				const lastColumn = Math.min(width - 1, Math.ceil(x1) - 1);
				for (let sx = firstColumn; sx <= lastColumn; sx += 1) {
					const weight = rowWeight * (Math.min(sx + 1, x1) - Math.max(sx, x0));
					if (weight <= 0) continue;
					const source = offset + sx * 4;
					const target = ox * 4;
					sums[target] += pixels[source] * weight;
					sums[target + 1] += pixels[source + 1] * weight;
					sums[target + 2] += pixels[source + 2] * weight;
					sums[target + 3] += pixels[source + 3] * weight;
					weights[ox] += weight;
				}
			}
		}
		const outRow = oy * targetWidth * 4;
		for (let ox = 0; ox < targetWidth; ox += 1) {
			const weight = weights[ox] || 1;
			const target = outRow + ox * 4;
			output[target] = Math.round(sums[ox * 4] / weight);
			output[target + 1] = Math.round(sums[ox * 4 + 1] / weight);
			output[target + 2] = Math.round(sums[ox * 4 + 2] / weight);
			output[target + 3] = Math.round(sums[ox * 4 + 3] / weight);
		}
	}
	return { width: targetWidth, height: targetHeight, pixels: output };
}
