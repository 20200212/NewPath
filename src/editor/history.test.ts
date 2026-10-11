import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createHistory, HISTORY_LIMIT, pushHistory, redo, undo } from "./history";

describe("history", () => {
	it("撤销、重做，新操作清空重做栈", () => {
		let history = createHistory(0);
		history = pushHistory(history, 1, { now: 0 });
		history = pushHistory(history, 2, { now: 1000 });
		history = undo(history);
		expect(history.present).toBe(1);
		expect(canRedo(history)).toBe(true);
		history = redo(history);
		expect(history.present).toBe(2);
		history = undo(history);
		history = pushHistory(history, 3, { now: 2000 });
		expect(canRedo(history)).toBe(false);
		expect(history.past).toEqual([0, 1]);
	});

	it("同一合并键在时间窗口内合并成一步", () => {
		let history = createHistory("a");
		history = pushHistory(history, "b", { coalesceKey: "nudge:1", now: 0 });
		history = pushHistory(history, "c", { coalesceKey: "nudge:1", now: 500 });
		history = pushHistory(history, "d", { coalesceKey: "nudge:1", now: 1000 });
		expect(history.past).toEqual(["a"]);
		expect(history.present).toBe("d");
		// 超过窗口或换了键都会新开一步
		history = pushHistory(history, "e", { coalesceKey: "nudge:1", now: 5000 });
		history = pushHistory(history, "f", { coalesceKey: "style:1", now: 5100 });
		expect(history.past).toEqual(["a", "d", "e"]);
	});

	it("撤销后不再与之前的操作合并", () => {
		let history = createHistory(0);
		history = pushHistory(history, 1, { coalesceKey: "k", now: 0 });
		history = undo(history);
		history = pushHistory(history, 2, { coalesceKey: "k", now: 100 });
		expect(history.past).toEqual([0]);
		expect(canUndo(history)).toBe(true);
	});

	it("超过上限时丢弃最早的记录", () => {
		let history = createHistory(0);
		for (let i = 1; i <= HISTORY_LIMIT + 10; i++) history = pushHistory(history, i, { now: i * 1000 });
		expect(history.past.length).toBe(HISTORY_LIMIT);
		expect(history.past[0]).toBe(10);
	});
});
