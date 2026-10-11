import type { Tool } from "./types";

export type EditorCommand =
	| { type: "tool"; tool: Tool }
	| {
			type:
				| "crop"
				| "undo"
				| "redo"
				| "copy"
				| "save"
				| "save-as"
				| "pin"
				| "ocr"
				| "smart-redact"
				| "stitch"
				| "duplicate"
				| "zoom-in"
				| "zoom-out"
				| "zoom-actual"
				| "zoom-fit";
	  };

/** 工具的单键快捷键（不带修饰键），同时用在按钮的提示文字里。 */
export const TOOL_KEYS: Record<Tool, string> = {
	select: "V",
	rect: "R",
	ellipse: "O",
	arrow: "A",
	line: "L",
	pen: "P",
	highlighter: "H",
	text: "T",
	counter: "N",
	redact: "M",
};

const TOOLS_BY_KEY = new Map(Object.entries(TOOL_KEYS).map(([tool, key]) => [key.toLowerCase(), tool as Tool]));

const MOD_COMMANDS: Record<string, EditorCommand["type"]> = {
	z: "undo",
	y: "redo",
	c: "copy",
	s: "save",
	d: "duplicate",
	"=": "zoom-in",
	"+": "zoom-in",
	"-": "zoom-out",
	"0": "zoom-actual",
	"9": "zoom-fit",
};

const MOD_SHIFT_COMMANDS: Record<string, EditorCommand["type"]> = {
	z: "redo",
	s: "save-as",
	p: "pin",
	t: "ocr",
	m: "smart-redact",
	a: "stitch",
	"+": "zoom-in",
	"=": "zoom-in",
};

export interface KeyInput {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** 编辑器的快捷键表（固定，不支持自定义）。Esc、Enter、Delete、方向键、[ ] 由编辑器单独处理。 */
export function commandForKey(event: KeyInput): EditorCommand | null {
	if (event.altKey) return null;
	const key = event.key.toLowerCase();
	const mod = event.ctrlKey || event.metaKey;
	if (mod) {
		const type = (event.shiftKey ? MOD_SHIFT_COMMANDS : MOD_COMMANDS)[key];
		return type ? ({ type } as EditorCommand) : null;
	}
	if (event.shiftKey) return null;
	if (key === "c") return { type: "crop" };
	const tool = TOOLS_BY_KEY.get(key);
	return tool ? { type: "tool", tool } : null;
}
