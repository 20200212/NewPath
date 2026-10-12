import type { ScrollStatus } from "../../electron/ipcTypes";

/** 快速滑动时偶尔对不上重叠部分，通常马上就能接上；持续这么久才提示“跟丢了”。 */
export const LOST_GRACE_MS = 600;

/** 长图相当于几屏，保留一位小数；不到 1.05 屏（还没怎么滚）时返回 null，不显示。 */
export function screensCount(height: number, frameHeight: number): string | null {
	if (!(frameHeight > 0) || !(height > 0)) return null;
	const screens = height / frameHeight;
	if (screens < 1.05) return null;
	return (Math.round(screens * 10) / 10).toFixed(1);
}

/**
 * 面板上显示的状态：lost 持续不到 LOST_GRACE_MS 时仍显示 capturing。
 * lostSince 是进入 lost 的时间，不在 lost 时为 null。
 */
export function displayedScrollStatus(status: ScrollStatus, lostSince: number | null, now: number): ScrollStatus {
	if (status !== "lost") return status;
	if (lostSince === null || now - lostSince < LOST_GRACE_MS) return "capturing";
	return "lost";
}

/** 还在滚动拼接中（指示灯闪烁）。 */
export function isScrollLive(status: ScrollStatus): boolean {
	return status === "waiting" || status === "capturing" || status === "behind" || status === "lost";
}
