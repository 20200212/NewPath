/** 快照式撤销 / 重做：每一步保存一份完整的文档（文档里的数组都是不可变替换，快照很便宜）。 */
export interface History<T> {
	past: T[];
	present: T;
	future: T[];
	/** 上一次 push 的合并键和时间，用来把连续的小修改合并成一步。 */
	lastKey: string | null;
	lastAt: number;
}

export const HISTORY_LIMIT = 200;
/** 同一个合并键在这段时间内的连续修改算作一步（拖动滑块、连续按方向键等）。 */
export const COALESCE_MS = 700;

export function createHistory<T>(present: T): History<T> {
	return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export interface PushOptions {
	coalesceKey?: string;
	now?: number;
}

export function pushHistory<T>(history: History<T>, next: T, options: PushOptions = {}): History<T> {
	if (next === history.present) return history;
	const now = options.now ?? Date.now();
	const key = options.coalesceKey ?? null;
	if (key !== null && key === history.lastKey && now - history.lastAt <= COALESCE_MS) {
		return { ...history, present: next, future: [], lastAt: now };
	}
	const past = [...history.past, history.present];
	if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
	return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function canUndo<T>(history: History<T>): boolean {
	return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
	return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
	if (!canUndo(history)) return history;
	const previous = history.past[history.past.length - 1];
	return {
		past: history.past.slice(0, -1),
		present: previous,
		future: [history.present, ...history.future],
		lastKey: null,
		lastAt: 0,
	};
}

export function redo<T>(history: History<T>): History<T> {
	if (!canRedo(history)) return history;
	const [next, ...future] = history.future;
	return { past: [...history.past, history.present], present: next, future, lastKey: null, lastAt: 0 };
}
