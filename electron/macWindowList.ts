import { nativeHelperPath, runNativeHelper } from "./nativeHelpers";
import { parseRawWindows, type RawWindow } from "./windowRects";

/** 小工具只调一次 CGWindowListCopyWindowInfo，通常几十毫秒就返回。 */
const TIMEOUT_MS = 1500;

/**
 * macOS 上枚举可见窗口，按 Z 序从前往后。坐标已经是全局 DIP（点），不需要再换算。
 * 小工具不存在（开发时没在 Mac 上编译）或出错时返回空数组，单击退回全屏。
 */
export async function listMacWindows(excludeProcessId: number): Promise<RawWindow[]> {
	const helper = nativeHelperPath("newpath-window-list");
	if (!helper) return [];
	try {
		return parseRawWindows(await runNativeHelper(helper, [String(excludeProcessId)], TIMEOUT_MS));
	} catch (error) {
		console.warn("枚举窗口失败", error);
		return [];
	}
}
