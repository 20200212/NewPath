import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flushDiagnostics, formatDiagnosticLine, initDiagnostics, LOG_FILE_NAME, serializeError, writeDiagnostic } from "./diagnostics";

describe("formatDiagnosticLine", () => {
	const now = new Date("2026-10-12T08:00:00.000Z");

	it("每行一个 JSON，带时间和事件名", () => {
		expect(formatDiagnosticLine("capture-started", { ms: 12 }, now)).toBe(
			'{"time":"2026-10-12T08:00:00.000Z","event":"capture-started","ms":12}\n',
		);
	});

	it("Error 转成文字，附加信息不能覆盖时间和事件名", () => {
		const line = formatDiagnosticLine("failed", { error: new Error("boom"), event: "x", time: "y" }, now);
		expect(JSON.parse(line)).toEqual({ time: "2026-10-12T08:00:00.000Z", event: "failed", error: "boom" });
	});

	it("不能序列化的附加信息不会让写日志失败", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(JSON.parse(formatDiagnosticLine("odd", { circular }, now))).toEqual({
			time: "2026-10-12T08:00:00.000Z",
			event: "odd",
			unserializable: true,
		});
	});
});

describe("serializeError", () => {
	it("把各种错误转成文字", () => {
		expect(serializeError(new Error("boom"))).toBe("boom");
		expect(serializeError("text")).toBe("text");
		expect(serializeError({ code: 1 })).toBe('{"code":1}');
	});
});

describe("诊断日志文件", () => {
	it("初始化之前的事件在初始化后补写进文件", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "newpath-diag-"));
		writeDiagnostic("early", { n: 1 });
		await initDiagnostics(dir);
		writeDiagnostic("later", { n: 2 });
		await flushDiagnostics();
		const lines = (await fs.readFile(path.join(dir, LOG_FILE_NAME), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		expect(lines.map((line) => line.event)).toEqual(["early", "later"]);
		await fs.rm(dir, { recursive: true, force: true });
	});
});
