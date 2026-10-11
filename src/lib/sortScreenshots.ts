import type { ScreenshotItem } from "../../electron/ipcTypes";

export type SortKey = "mtime" | "size";
export type SortDir = "asc" | "desc";

export interface SortState {
	key: SortKey;
	dir: SortDir;
}

/** 默认最新的在前，和主进程返回的顺序一致。 */
export const DEFAULT_SORT: SortState = { key: "mtime", dir: "desc" };

/** 点击列头：同一列切换方向，换列时从降序（最新 / 最大在前）开始。 */
export function toggleSort(current: SortState, key: SortKey): SortState {
	if (current.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
	return { key, dir: "desc" };
}

/** 返回排好序的新数组；值相同时按文件名排，保证顺序稳定。 */
export function sortScreenshots(items: readonly ScreenshotItem[], sort: SortState): ScreenshotItem[] {
	const value = (item: ScreenshotItem) => (sort.key === "mtime" ? item.mtimeMs : item.size);
	const sign = sort.dir === "asc" ? 1 : -1;
	return [...items].sort((a, b) => sign * (value(a) - value(b)) || a.name.localeCompare(b.name));
}
