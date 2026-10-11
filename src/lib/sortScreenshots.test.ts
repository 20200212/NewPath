import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, sortScreenshots, toggleSort } from "./sortScreenshots";

const items = [
	{ name: "b.png", size: 300, mtimeMs: 2000 },
	{ name: "a.png", size: 100, mtimeMs: 3000 },
	{ name: "c.png", size: 200, mtimeMs: 1000 },
	{ name: "d.png", size: 100, mtimeMs: 3000 },
];
const names = (list: { name: string }[]) => list.map((item) => item.name);

describe("sortScreenshots", () => {
	it("按修改时间排序，相同时按文件名", () => {
		expect(names(sortScreenshots(items, { key: "mtime", dir: "desc" }))).toEqual(["a.png", "d.png", "b.png", "c.png"]);
		expect(names(sortScreenshots(items, { key: "mtime", dir: "asc" }))).toEqual(["c.png", "b.png", "a.png", "d.png"]);
	});

	it("按大小排序", () => {
		expect(names(sortScreenshots(items, { key: "size", dir: "desc" }))).toEqual(["b.png", "c.png", "a.png", "d.png"]);
		expect(names(sortScreenshots(items, { key: "size", dir: "asc" }))).toEqual(["a.png", "d.png", "c.png", "b.png"]);
	});

	it("不修改原数组", () => {
		const before = names(items);
		sortScreenshots(items, { key: "size", dir: "asc" });
		expect(names(items)).toEqual(before);
	});
});

describe("toggleSort", () => {
	it("同一列切换方向，换列从降序开始", () => {
		expect(toggleSort(DEFAULT_SORT, "mtime")).toEqual({ key: "mtime", dir: "asc" });
		expect(toggleSort({ key: "mtime", dir: "asc" }, "mtime")).toEqual({ key: "mtime", dir: "desc" });
		expect(toggleSort({ key: "mtime", dir: "asc" }, "size")).toEqual({ key: "size", dir: "desc" });
	});
});
