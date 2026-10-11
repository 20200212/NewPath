/** 键盘事件里用到的字段，单独列出来方便在 node 环境下测试。 */
export interface KeyInput {
	key: string;
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

/** 无效的原因：unsupported 不支持这个按键；needs-modifier 缺少 Ctrl / Alt / Win。文案由界面按码映射。 */
export type AcceleratorError = "unsupported" | "needs-modifier";

export type AcceleratorResult =
	| { status: "pending"; modifiers: string[] }
	| { status: "ok"; accelerator: string }
	| { status: "invalid"; reason: AcceleratorError };

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

const NAMED_CODES: Record<string, string> = {
	Space: "Space",
	Tab: "Tab",
	Enter: "Enter",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	PrintScreen: "PrintScreen",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Backquote: "`",
};

/** 不带修饰键也允许单独使用的键。 */
const STANDALONE = /^(F([1-9]|1[0-9]|2[0-4])|PrintScreen)$/;

/** 按物理键位（event.code）取键名，不受输入法和键盘布局影响。 */
function keyName(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
	if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
	return NAMED_CODES[code] ?? null;
}

function modifiersOf(input: KeyInput, mac: boolean): string[] {
	const modifiers: string[] = [];
	if (input.ctrlKey) modifiers.push("Ctrl");
	if (input.altKey) modifiers.push("Alt");
	if (input.shiftKey) modifiers.push("Shift");
	if (input.metaKey) modifiers.push(mac ? "Command" : "Super");
	return modifiers;
}

/** 把一次按键转换成 Electron 加速键字符串，例如 Ctrl+Shift+A。 */
export function acceleratorFromKey(input: KeyInput, mac = false): AcceleratorResult {
	const modifiers = modifiersOf(input, mac);
	if (MODIFIER_KEYS.has(input.key)) return { status: "pending", modifiers };

	const key = keyName(input.code);
	if (!key) return { status: "invalid", reason: "unsupported" };
	// 只按 Shift 加字母会占用大写输入，至少要有 Ctrl / Alt / Win
	const hasMainModifier = input.ctrlKey || input.altKey || input.metaKey;
	if (!hasMainModifier && !STANDALONE.test(key)) {
		return { status: "invalid", reason: "needs-modifier" };
	}
	return { status: "ok", accelerator: [...modifiers, key].join("+") };
}

const DISPLAY_NAMES: Record<string, string> = { Super: "Win", Command: "⌘", CommandOrControl: "Ctrl", Control: "Ctrl" };

/** macOS 的修饰键符号，显示时按系统惯例 ⌃⌥⇧⌘ 排在按键前面、不加分隔。 */
const MAC_MODIFIERS: Record<string, string> = {
	Ctrl: "⌃",
	Control: "⌃",
	Alt: "⌥",
	Option: "⌥",
	Shift: "⇧",
	Command: "⌘",
	Cmd: "⌘",
	CommandOrControl: "⌘",
	CmdOrCtrl: "⌘",
	Super: "⌘",
	Meta: "⌘",
};
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const MAC_KEYS: Record<string, string> = {
	Up: "↑",
	Down: "↓",
	Left: "←",
	Right: "→",
	Enter: "↩",
	Backspace: "⌫",
	Delete: "⌦",
	Tab: "⇥",
	Escape: "⎋",
	Esc: "⎋",
};

/**
 * 显示用的文本：Ctrl+Shift+A → Ctrl + Shift + A；
 * mac 为 true 时按 macOS 习惯显示成符号，Command+Shift+A → ⇧⌘A。
 */
export function formatAccelerator(accelerator: string, mac = false): string {
	const parts = splitAccelerator(accelerator);
	if (!mac) return parts.map((part) => DISPLAY_NAMES[part] ?? part).join(" + ");
	const modifiers: string[] = [];
	const keys: string[] = [];
	for (const part of parts) {
		const symbol = MAC_MODIFIERS[part];
		if (symbol) modifiers.push(symbol);
		else keys.push(MAC_KEYS[part] ?? part);
	}
	modifiers.sort((a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b));
	return [...new Set(modifiers)].join("") + keys.join("");
}

/**
 * 应用内快捷键（编辑器、钉图）的提示文本。这些快捷键写成 Windows 习惯的 "Ctrl+S"，
 * 处理按键时 Ctrl 和 ⌘ 都认；macOS 上显示成 ⌘S，Delete 显示成 Mac 键盘上的 ⌫。
 */
export function formatAppShortcut(shortcut: string, mac: boolean): string {
	if (!mac) return shortcut;
	const parts = splitAccelerator(shortcut).map((part) => (part === "Ctrl" ? "Command" : part === "Delete" ? "Backspace" : part));
	return formatAccelerator(parts.join("+"), true);
}

/** 按 + 拆分；按键本身是 + 时（如 Ctrl++）保留最后的 +。 */
function splitAccelerator(accelerator: string): string[] {
	const parts = accelerator.split("+");
	if (accelerator.endsWith("++")) return [...parts.slice(0, -2), "+"];
	return parts;
}
