import { mt } from "./i18n";
import { nativeHelperPath, runNativeHelper } from "./nativeHelpers";
import type { OcrEngine } from "./ocr";

const OCR_TIMEOUT_MS = 30_000;

/**
 * macOS 的 Vision 框架（VNRecognizeTextRequest），由 native/newpath-ocr 小工具调用。
 * Vision 识别前会把大图缩小到固定的像素预算，长图上的小字会糊掉，所以切成较矮的块；
 * Retina 截图本身分辨率够高，不再放大。小工具不存在（开发时没在 Mac 上编译）时返回 null。
 */
export function macOcrEngine(): OcrEngine | null {
	const helper = nativeHelperPath("newpath-ocr");
	if (!helper) return null;
	return {
		scale: () => 1,
		tileHeight: 2048,
		run: (files) => runNativeHelper(helper, files, OCR_TIMEOUT_MS),
		errorReason: () => mt().ocrFailed,
	};
}
