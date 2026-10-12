import type { OnboardingStep, ScreenPermission } from "../../electron/ipcTypes";

/** 引导的步骤顺序；授权这一步只在 macOS 上有。 */
export function onboardingSteps(includePermission: boolean): OnboardingStep[] {
	return includePermission ? ["welcome", "permission", "done"] : ["welcome", "done"];
}

/** 下一步；已经是最后一步时返回 null。不在列表里的步骤当作第一步。 */
export function nextOnboardingStep(steps: readonly OnboardingStep[], step: OnboardingStep): OnboardingStep | null {
	const index = Math.max(0, steps.indexOf(step));
	return steps[index + 1] ?? null;
}

/** 上一步；已经是第一步时返回 null。 */
export function previousOnboardingStep(steps: readonly OnboardingStep[], step: OnboardingStep): OnboardingStep | null {
	const index = steps.indexOf(step);
	return index > 0 ? steps[index - 1] : null;
}

/** 只有 granted 才算授权；restricted 是被系统策略（如家长控制、MDM）禁止的。 */
export function isPermissionGranted(permission: ScreenPermission): boolean {
	return permission === "granted";
}
