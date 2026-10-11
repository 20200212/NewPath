import { describe, expect, it } from "vitest";
import { acceleratorFromKey, formatAccelerator, type KeyInput } from "./accelerator";

const press = (key: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
	key,
	code,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	metaKey: false,
	...mods,
});

describe("acceleratorFromKey", () => {
	it("组合键按 Ctrl、Alt、Shift、Win 的顺序输出", () => {
		expect(acceleratorFromKey(press("A", "KeyA", { ctrlKey: true, shiftKey: true }))).toEqual({
			status: "ok",
			accelerator: "Ctrl+Shift+A",
		});
		expect(acceleratorFromKey(press("ç", "KeyC", { altKey: true }))).toEqual({ status: "ok", accelerator: "Alt+C" });
		expect(acceleratorFromKey(press("1", "Digit1", { metaKey: true, altKey: true }))).toEqual({
			status: "ok",
			accelerator: "Alt+Super+1",
		});
		expect(acceleratorFromKey(press("a", "KeyA", { metaKey: true }), true)).toEqual({
			status: "ok",
			accelerator: "Command+A",
		});
	});

	it("只按下修饰键时等待后续按键", () => {
		expect(acceleratorFromKey(press("Control", "ControlLeft", { ctrlKey: true }))).toEqual({
			status: "pending",
			modifiers: ["Ctrl"],
		});
	});

	it("功能键和截屏键可以单独使用", () => {
		expect(acceleratorFromKey(press("F1", "F1"))).toEqual({ status: "ok", accelerator: "F1" });
		expect(acceleratorFromKey(press("PrintScreen", "PrintScreen"))).toEqual({
			status: "ok",
			accelerator: "PrintScreen",
		});
	});

	it("普通键缺少修饰键时拒绝", () => {
		expect(acceleratorFromKey(press("a", "KeyA"))).toEqual({ status: "invalid", reason: "needs-modifier" });
		expect(acceleratorFromKey(press("A", "KeyA", { shiftKey: true }))).toEqual({
			status: "invalid",
			reason: "needs-modifier",
		});
	});

	it("无法识别的按键返回 unsupported", () => {
		expect(acceleratorFromKey(press("Unidentified", "IntlRo", { ctrlKey: true }))).toEqual({
			status: "invalid",
			reason: "unsupported",
		});
	});
});

describe("formatAccelerator", () => {
	it("用空格分隔并替换显示名", () => {
		expect(formatAccelerator("Ctrl+Shift+A")).toBe("Ctrl + Shift + A");
		expect(formatAccelerator("Alt+Super+1")).toBe("Alt + Win + 1");
	});
});
