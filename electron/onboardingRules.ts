import type { OnboardingStep } from "./ipcTypes";

// 欢迎引导用到的常量和纯函数（不依赖 electron，方便测试）。

/** 引导内容有大的变化时加一，老用户也会再看到一次。 */
export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ["welcome", "permission", "done"];
/** 授权后由引导发起的重启带上这个参数，重启后直接停在对应步骤。 */
export const ONBOARDING_RELAUNCH_ARG = "--newpath-onboarding=";
/** 系统设置里“屏幕录制”那一页。 */
export const SCREEN_RECORDING_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
export const ONBOARDING_SIZE = { width: 760, height: 540 };
/** macOS 红绿灯的位置，和引导页标题栏里留出的空位对齐。 */
export const ONBOARDING_TRAFFIC_LIGHTS = { x: 18, y: 18 };
export const HELPER_SIZE = { width: 400, height: 96 };
const HELPER_GAP = 10;

/** 命令行里的 --newpath-onboarding=<步骤>。 */
export function relaunchStepFromArgs(argv: readonly string[]): OnboardingStep | null {
	const arg = argv.find((item) => item.startsWith(ONBOARDING_RELAUNCH_ARG));
	const step = arg?.slice(ONBOARDING_RELAUNCH_ARG.length);
	return ONBOARDING_STEPS.includes(step as OnboardingStep) ? (step as OnboardingStep) : null;
}

type Box = { x: number; y: number; width: number; height: number };

/** 拖拽小窗放在系统设置窗口正下方、水平居中；下面没地方时收进窗口底部。坐标都是全局点。 */
export function placePermissionHelper(settingsWindow: Box, workArea: Box, size = HELPER_SIZE, gap = HELPER_GAP) {
	const x = Math.round(
		Math.min(
			Math.max(workArea.x + 8, settingsWindow.x + (settingsWindow.width - size.width) / 2),
			workArea.x + workArea.width - size.width - 8,
		),
	);
	let y = Math.round(settingsWindow.y + settingsWindow.height + gap);
	if (y + size.height > workArea.y + workArea.height) {
		y = Math.round(settingsWindow.y + settingsWindow.height - size.height - 16);
	}
	return { x, y };
}
