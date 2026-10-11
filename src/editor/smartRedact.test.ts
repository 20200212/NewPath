import { describe, expect, it } from "vitest";
import { describeKinds, regionsToRedactions } from "./smartRedact";
import type { Annotation } from "./types";

let seq = 0;
const makeId = () => `id${++seq}`;

describe("smartRedact", () => {
	it("生成打码标注，强度至少是高度的 0.3 倍", () => {
		const result = regionsToRedactions(
			[
				{ x: 0, y: 0, width: 100, height: 20, kind: "email" },
				{ x: 0, y: 50, width: 100, height: 100, kind: "ip" },
			],
			[],
			"pixelate",
			10,
			makeId,
		);
		expect(result.map((item) => item.strength)).toEqual([10, 30]);
		expect(result[0]).toMatchObject({ kind: "redact", x: 0, y: 0, w: 100, h: 20, mode: "pixelate" });
	});

	it("已经盖住的区域不重复打码", () => {
		const existing: Annotation[] = [{ id: "r", kind: "redact", x: 0, y: 0, w: 100, h: 20, mode: "blur", strength: 10 }];
		const regions = [
			{ x: 0, y: 0, width: 100, height: 20, kind: "email" as const },
			{ x: 0, y: 0, width: 100, height: 20, kind: "email" as const },
			{ x: 50, y: 10, width: 100, height: 20, kind: "ip" as const },
		];
		expect(regionsToRedactions(regions, existing, "blur", 10, makeId)).toHaveLength(1);
	});

	it("提示里列出去重后的类型", () => {
		expect(
			describeKinds([
				{ x: 0, y: 0, width: 1, height: 1, kind: "email" },
				{ x: 0, y: 0, width: 1, height: 1, kind: "ip" },
				{ x: 0, y: 0, width: 1, height: 1, kind: "email" },
			]),
		).toBe("邮箱、IP 地址");
	});
});
