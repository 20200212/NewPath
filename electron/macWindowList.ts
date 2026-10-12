import type { CaptureAgent } from "./captureAgent";
import { serializeError, writeDiagnostic } from "./diagnostics";
import { nativeHelperPath, runNativeHelper } from "./nativeHelpers";
import { normalizeRawWindows, parseRawWindows, type RawWindow } from "./windowRects";

/** 截图进程常驻，枚举窗口通常十几毫秒；单独运行小工具要多等它启动。 */
const AGENT_TIMEOUT_MS = 800;
const HELPER_TIMEOUT_MS = 1500;

/**
 * macOS 上枚举可见窗口，按 Z 序从前往后，带窗口编号（CGWindowID）。坐标已经是全局 DIP（点），不需要再换算。
 * 先问常驻的截图进程，不可用时运行一次 newpath-window-list；都不行（开发时没在 Mac 上编译）返回空数组，单击退回全屏。
 */
export async function listMacWindows(excludeProcessId: number, agent: CaptureAgent | null): Promise<RawWindow[]> {
	const startedAt = Date.now();
	const response = await agent?.request({ cmd: "windows", exclude: excludeProcessId, excludeWindows: [] }, AGENT_TIMEOUT_MS);
	if (response?.ok) {
		const windows = normalizeRawWindows(response.windows);
		writeDiagnostic("window-list", { via: "agent", count: windows.length, ms: Date.now() - startedAt });
		return windows;
	}
	const helper = nativeHelperPath("newpath-window-list");
	if (!helper) return [];
	try {
		const windows = parseRawWindows(await runNativeHelper(helper, [String(excludeProcessId)], HELPER_TIMEOUT_MS));
		writeDiagnostic("window-list", { via: "helper", count: windows.length, ms: Date.now() - startedAt });
		return windows;
	} catch (error) {
		writeDiagnostic("window-list-failed", { error: serializeError(error) });
		return [];
	}
}
