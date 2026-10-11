import { describe, expect, it } from "vitest";
import { acceleratorFromKey, formatAccelerator, formatAppShortcut, type KeyInput } from "./accelerator";

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

	it("macOS 上显示成符号，修饰键按 ⌃⌥⇧⌘ 排序", () => {
		expect(formatAccelerator("Command+Shift+X", true)).toBe("⇧⌘X");
		expect(formatAccelerator("Shift+Alt+Ctrl+A", true)).toBe("⌃⌥⇧A");
		expect(formatAccelerator("Ctrl+Up", true)).toBe("⌃↑");
		expect(formatAccelerator("F1", true)).toBe("F1");
	});

	it("按键本身是 + 时不被拆掉", () => {
		expect(formatAccelerator("Ctrl++")).toBe("Ctrl + +");
		expect(formatAccelerator("Command++", true)).toBe("⌘+");
	});
});

describe("formatAppShortcut", () => {
	it("Windows 上原样显示", () => {
		expect(formatAppShortcut("Ctrl+Shift+S", false)).toBe("Ctrl+Shift+S");
		expect(formatAppShortcut("Delete", false)).toBe("Delete");
	});

	it("macOS 上 Ctrl 显示成 ⌘，Delete 显示成 ⌫", () => {
		expect(formatAppShortcut("Ctrl+Shift+S", true)).toBe("⇧⌘S");
		expect(formatAppShortcut("Ctrl+-", true)).toBe("⌘-");
		expect(formatAppShortcut("Ctrl+=", true)).toBe("⌘=");
		expect(formatAppShortcut("Delete", true)).toBe("⌫");
		expect(formatAppShortcut("C", true)).toBe("C");
	});
});
