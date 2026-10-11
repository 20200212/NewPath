import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nativeImage } from "electron";
import { mt } from "./i18n";
import type { OcrResult } from "./ipcTypes";
import { macOcrEngine } from "./macOcr";
import { parseOcrOutput, planOcrTiles } from "./ocrResult";
import { windowsOcrEngine } from "./windowsOcr";

/** 一种系统 OCR：识别前怎样缩放、切块，以及怎样识别一组 PNG 文件。 */
export interface OcrEngine {
	/** 识别前把图片缩放的倍数。 */
	scale: (size: { width: number; height: number }) => number;
	/** 纵向切块的高度（缩放后的像素）。 */
	tileHeight: number;
	/** 依次识别这些文件，输出 parseOcrOutput 能解析的 JSON。 */
	run: (files: string[]) => Promise<string>;
	/** 识别输出里的错误码换成给用户看的原因。 */
	errorReason: (code: string) => string;
}

/** 当前系统可用的 OCR；没有时返回 null。 */
function currentEngine(): OcrEngine | null {
	if (process.platform === "win32") return windowsOcrEngine;
	if (process.platform === "darwin") return macOcrEngine();
	return null;
}

/** 识别 PNG 里的文字。图片按引擎的要求缩放、纵向切块后写进临时目录，结果坐标都换算回原图像素。 */
export async function recognizeText(png: Buffer): Promise<OcrResult> {
	const engine = currentEngine();
	if (!engine) return { ok: false, reason: mt().ocrUnsupported };
	const image = nativeImage.createFromBuffer(png);
	if (image.isEmpty()) return { ok: false, reason: mt().cannotReadImage };
	const size = image.getSize();
	const scale = engine.scale(size);
	const scaled =
		scale === 1
			? image
			: image.resize({
					width: Math.max(1, Math.round(size.width * scale)),
					height: Math.max(1, Math.round(size.height * scale)),
					quality: "best",
				});
	const scaledSize = scaled.getSize();
	const tiles = planOcrTiles(scaledSize.height, engine.tileHeight);

	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "newpath-ocr-"));
	try {
		const files = await Promise.all(
			tiles.map(async (tile, index) => {
				const file = path.join(dir, `tile-${index}.png`);
				const piece = scaled.crop({ x: 0, y: tile.offsetY, width: scaledSize.width, height: tile.height });
				await fs.writeFile(file, piece.toPNG());
				return file;
			}),
		);
		const parsed = parseOcrOutput(await engine.run(files), tiles, scale);
		return parsed.ok ? parsed : { ok: false, reason: engine.errorReason(parsed.error) };
	} catch (error) {
		console.warn("OCR 失败", error);
		return { ok: false, reason: mt().ocrFailedRetry };
	} finally {
		void fs.rm(dir, { recursive: true, force: true });
	}
}
