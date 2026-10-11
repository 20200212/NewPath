import { describe, expect, it } from "vitest";
import { commandForKey, type KeyInput } from "./keymap";

const key = (value: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
	key: value,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...modifiers,
});

describe("keymap", () => {
	it("单键切换工具和裁剪", () => {
		expect(commandForKey(key("r"))).toEqual({ type: "tool", tool: "rect" });
		expect(commandForKey(key("M"))).toEqual({ type: "tool", tool: "redact" });
		expect(commandForKey(key("c"))).toEqual({ type: "crop" });
		expect(commandForKey(key("q"))).toBeNull();
	});

	it("Ctrl 组合键", () => {
		expect(commandForKey(key("z", { ctrlKey: true }))).toEqual({ type: "undo" });
		expect(commandForKey(key("Z", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "redo" });
		expect(commandForKey(key("s", { ctrlKey: true }))).toEqual({ type: "save" });
		expect(commandForKey(key("S", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "save-as" });
		expect(commandForKey(key("P", { metaKey: true, shiftKey: true }))).toEqual({ type: "pin" });
		expect(commandForKey(key("=", { ctrlKey: true }))).toEqual({ type: "zoom-in" });
		expect(commandForKey(key("0", { ctrlKey: true }))).toEqual({ type: "zoom-actual" });
	});

	it("Shift 或 Alt 加单键不触发工具", () => {
		expect(commandForKey(key("R", { shiftKey: true }))).toBeNull();
		expect(commandForKey(key("r", { altKey: true }))).toBeNull();
	});
});
