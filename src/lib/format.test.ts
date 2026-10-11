import { describe, expect, it } from "vitest";
import { formatBytes, formatDate } from "./format";

describe("formatBytes", () => {
	it("按 1024 进位，小于 10 时保留一位小数", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1023)).toBe("1023 B");
		expect(formatBytes(1024)).toBe("1 KB");
		expect(formatBytes(126_976)).toBe("124 KB");
		expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
		expect(formatBytes(145 * 1024 * 1024)).toBe("145 MB");
	});
});

describe("formatDate", () => {
	it("输出本地时间的 年/月/日 时:分", () => {
		expect(formatDate(new Date(2026, 9, 1, 9, 5).getTime())).toBe("2026/10/01 09:05");
	});
});
