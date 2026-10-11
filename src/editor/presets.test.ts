import { describe, expect, it } from "vitest";
import {
	clampUnit,
	contrastColor,
	DEFAULT_STYLE,
	restyleAnnotation,
	sanitizeStyle,
	stepSize,
	strokeWidthFor,
	styleFromAnnotation,
	withAlpha,
} from "./presets";
import type { Annotation, TextAnnotation } from "./types";

const measure = (text: string, size: number) => ({ w: text.length * size, h: size * 1.5 });

describe("presets", () => {
	it("尺寸按截图缩放比例放大", () => {
		expect(strokeWidthFor("rect", 1, 2)).toBe(8);
		expect(strokeWidthFor("highlighter", 0, 1)).toBe(10);
		expect(clampUnit(0.5)).toBe(1);
		expect(clampUnit(10)).toBe(4);
	});

	it("标注样式映射回最近的一档", () => {
		const rect: Annotation = { id: "r", kind: "rect", x: 0, y: 0, w: 1, h: 1, color: "#007AFF", width: 14, fill: "soft" };
		expect(styleFromAnnotation(rect, 2)).toEqual({ color: "#007AFF", fill: "soft", strokeSize: 2 });
	});

	it("只修改 patch 里有、且对该标注有意义的属性", () => {
		const rect: Annotation = { id: "r", kind: "rect", x: 0, y: 0, w: 1, h: 1, color: "#007AFF", width: 4, fill: "none" };
		expect(restyleAnnotation(rect, { color: "#FF3B30", textSize: 3 }, 1, measure)).toEqual({ ...rect, color: "#FF3B30" });
		const text: TextAnnotation = { id: "t", kind: "text", x: 0, y: 0, w: 40, h: 30, text: "ab", color: "#000000", size: 20, style: "plain" };
		expect(restyleAnnotation(text, { textSize: 3 }, 1, measure)).toMatchObject({ size: 40, w: 80, h: 60 });
	});

	it("[ ] 调整当前档位，限制在范围内", () => {
		expect(stepSize(DEFAULT_STYLE, "rect", 1)).toEqual({ strokeSize: 2 });
		expect(stepSize({ ...DEFAULT_STYLE, strokeSize: 2 }, "rect", 1)).toEqual({ strokeSize: 2 });
		expect(stepSize(DEFAULT_STYLE, "text", -1)).toEqual({ textSize: 0 });
	});

	it("读取保存的样式时丢弃非法值", () => {
		expect(sanitizeStyle({ color: "red", strokeSize: 5, fill: "solid" })).toEqual({ ...DEFAULT_STYLE, fill: "solid" });
		expect(sanitizeStyle(null)).toEqual(DEFAULT_STYLE);
	});

	it("颜色工具", () => {
		expect(withAlpha("#FF3B30", 0.5)).toBe("rgba(255, 59, 48, 0.5)");
		expect(contrastColor("#FFCC00")).toBe("#1C1C1E");
		expect(contrastColor("#007AFF")).toBe("#FFFFFF");
	});
});
