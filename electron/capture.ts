import { desktopCapturer, type Display, type NativeImage } from "electron";

/**
 * 截取指定显示器的完整画面（物理像素）。
 * macOS 未授予屏幕录制权限时会返回空图片，调用方需要处理。
 */
export async function captureDisplay(display: Display): Promise<NativeImage | null> {
	const { width, height } = display.size;
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: {
			width: Math.round(width * display.scaleFactor),
			height: Math.round(height * display.scaleFactor),
		},
	});
	const source =
		sources.find((item) => item.display_id === String(display.id)) ??
		(sources.length === 1 ? sources[0] : undefined);
	if (!source || source.thumbnail.isEmpty()) return null;
	return source.thumbnail;
}
