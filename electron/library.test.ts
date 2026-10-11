import path from "node:path";
import { describe, expect, it } from "vitest";
import { isImageFile, resolveInDir, uniqueFileName, validateFileName } from "./library";

describe("resolveInDir", () => {
	const dir = path.join("C:", "shots");

	it("拼出目录里的文件路径", () => {
		expect(resolveInDir(dir, "a.png")).toBe(path.join(dir, "a.png"));
	});

	it("拒绝路径穿越和非字符串", () => {
		expect(resolveInDir(dir, "../a.png")).toBeNull();
		expect(resolveInDir(dir, "sub\\a.png")).toBeNull();
		expect(resolveInDir(dir, "..")).toBeNull();
		expect(resolveInDir(dir, "")).toBeNull();
		expect(resolveInDir(dir, 42)).toBeNull();
	});
});

describe("validateFileName", () => {
	it("沿用原扩展名", () => {
		expect(validateFileName("新名字", "截图.png")).toEqual({ ok: true, name: "新名字.png" });
		expect(validateFileName("  新名字.PNG ", "截图.png")).toEqual({ ok: true, name: "新名字.png" });
		expect(validateFileName("a.jpg", "截图.png")).toEqual({ ok: true, name: "a.jpg.png" });
	});

	it("拒绝非法名字", () => {
		for (const input of ["", "   ", ".png", "a/b", "a:b", "a?", "con", "LPT1", "abc.", 1]) {
			expect(validateFileName(input, "截图.png").ok).toBe(false);
		}
		expect(validateFileName("a".repeat(201), "截图.png").ok).toBe(false);
	});
});

describe("uniqueFileName", () => {
	it("没有重名时原样返回", () => {
		expect(uniqueFileName("a.png", ["b.png"])).toBe("a.png");
	});

	it("重名时追加序号，不区分大小写", () => {
		expect(uniqueFileName("a.png", ["A.PNG", "a (1).png"])).toBe("a (2).png");
	});
});

describe("isImageFile", () => {
	it("只认 png / jpg / jpeg", () => {
		expect(isImageFile("a.PNG")).toBe(true);
		expect(isImageFile("a.jpeg")).toBe(true);
		expect(isImageFile("a.gif")).toBe(false);
		expect(isImageFile("png")).toBe(false);
	});
});
