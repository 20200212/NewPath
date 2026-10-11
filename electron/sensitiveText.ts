import type { OcrLine, SensitiveKind, SensitiveRegion } from "./ipcTypes";
import { charWeight, layoutLine, type LineSegment } from "./ocrResult";

/** 本机的用户名、主机名：出现在截图里通常就是隐私。 */
export interface Identity {
	userNames: string[];
	hostNames: string[];
}

/** 一行文本里命中的字符区间 [start, end)。 */
export interface SensitiveRange {
	start: number;
	end: number;
	kind: SensitiveKind;
}

/** 系统自带的公共用户目录，不算隐私。 */
const SHARED_HOME_NAMES = new Set(["public", "default", "default user", "all users", "shared", "guest"]);

/** 配置示例里常见的占位写法，不当作真实密钥。 */
const PLACEHOLDER = /^(?:\$|<|\{|%|process\.env|os\.environ|\*+$|x+$|\.+$|true$|false$|null$|undefined$|none$|\d+$)/i;

const SECRET_PREFIXES = new RegExp(
	[
		"sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}",
		"gh[pousr]_[A-Za-z0-9]{20,}",
		"github_pat_[A-Za-z0-9_]{20,}",
		"glpat-[A-Za-z0-9_-]{16,}",
		"(?:AKIA|ASIA)[A-Z0-9]{16}",
		"AIza[0-9A-Za-z_-]{30,}",
		"xox[abposr]-[A-Za-z0-9-]{10,}",
		"[rs]k_live_[A-Za-z0-9]{16,}",
		"npm_[A-Za-z0-9]{30,}",
		"hf_[A-Za-z0-9]{30,}",
		"eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
	].join("|"),
	"g",
);

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIpv4(parts: string[]) {
	const numbers = parts.map(Number);
	if (numbers.some((value) => value > 255)) return false;
	return ![0, 127, 255].includes(numbers[0]);
}

/** 校验 IPv6：最多一个 "::"，每组 1–4 位十六进制；不带 "::" 时必须正好 8 组（排除 12:30:45 这类时间）。 */
function isIpv6(candidate: string) {
	const doubleColons = candidate.split("::").length - 1;
	if (doubleColons > 1) return false;
	const groups = candidate.split(":").filter(Boolean);
	if (!groups.every((group) => /^[0-9A-Fa-f]{1,4}$/.test(group))) return false;
	return doubleColons === 1 ? groups.length >= 2 && groups.length <= 7 : groups.length === 8;
}

/** 在一行文本里找出所有敏感内容的字符区间。 */
export function findSensitiveRanges(text: string, identity: Identity): SensitiveRange[] {
	const ranges: SensitiveRange[] = [];
	const add = (start: number, end: number, kind: SensitiveKind) => {
		if (end > start) ranges.push({ start, end, kind });
	};
	/** 只打码第 group 个捕获组。 */
	const addGroup = (match: RegExpExecArray, group: number, kind: SensitiveKind) => {
		const span = match.indices?.[group];
		if (span) add(span[0], span[1], kind);
	};
	const addMatch = (match: RegExpExecArray, kind: SensitiveKind) => add(match.index, match.index + match[0].length, kind);

	// 终端提示符 user@host（可带 (venv) 前缀）
	for (const match of text.matchAll(/^\s*(?:\([^)]*\)\s*)?([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)(?=[:\s~$#]|$)/dg)) {
		if (match[1].toLowerCase() === "git") continue;
		addGroup(match, 1, "username");
		addGroup(match, 2, "hostname");
	}

	for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
		if (match[0].toLowerCase().startsWith("git@")) continue;
		addMatch(match, "email");
	}

	// 用户目录里的用户名
	for (const match of text.matchAll(/(?:[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)([^\\/\s"'<>|:*?]+)/dgi)) {
		if (SHARED_HOME_NAMES.has(match[1].toLowerCase())) continue;
		addGroup(match, 1, "username");
	}

	for (const match of text.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)/g)) {
		if (isIpv4(match.slice(1, 5))) addMatch(match, "ip");
	}

	for (const match of text.matchAll(/(?<![0-9A-Fa-f:-])[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}(?![0-9A-Fa-f:-])/g)) {
		addMatch(match, "mac");
	}

	for (const match of text.matchAll(/(?<![\w:])[0-9A-Fa-f:]{6,39}(?![\w:])/g)) {
		if (isIpv6(match[0])) addMatch(match, "ip");
	}

	for (const match of text.matchAll(SECRET_PREFIXES)) addMatch(match, "secret");

	// key=value、key: value 形式的配置项，只打码值
	for (const match of text.matchAll(
		/(?<![A-Za-z0-9])[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?key|secret|token|passwd|password|pwd|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["'`]?([^\s"'`,;]{4,})/dgi,
	)) {
		if (!PLACEHOLDER.test(match[1])) addGroup(match, 1, "secret");
	}

	// 命令行参数 --token xxx
	for (const match of text.matchAll(/--?(?:api[-_]?key|token|secret|password|passwd|pwd)(?:=|\s+)["']?([^\s"']{4,})/dgi)) {
		if (!PLACEHOLDER.test(match[1])) addGroup(match, 1, "secret");
	}

	for (const match of text.matchAll(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/dgi)) addGroup(match, 1, "secret");

	// 中国大陆手机号、18 位身份证号
	for (const match of text.matchAll(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)/g)) addMatch(match, "phone");
	for (const match of text.matchAll(
		/(?<![0-9A-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/g,
	)) {
		addMatch(match, "id-card");
	}

	// 本机用户名、主机名：太短的名字容易误伤，只在上面的提示符、路径规则里匹配
	const names: [string, SensitiveKind][] = [
		...identity.userNames.map((name): [string, SensitiveKind] => [name, "username"]),
		...identity.hostNames.map((name): [string, SensitiveKind] => [name, "hostname"]),
	];
	for (const [name, kind] of names) {
		if (name.length < 3 || name.toLowerCase() === "localhost") continue;
		const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, "gi");
		for (const match of text.matchAll(pattern)) addMatch(match, kind);
	}

	return ranges.sort((a, b) => a.start - b.start);
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
	kind: SensitiveKind;
}

/** 词内按字宽（中文算两个）插值出字符的横向位置。 */
function charOffset(text: string, index: number) {
	let total = 0;
	let before = 0;
	for (let i = 0; i < text.length; i++) {
		const weight = charWeight(text[i]);
		if (i < index) before += weight;
		total += weight;
	}
	return total === 0 ? 0 : before / total;
}

/** 把字符区间换算成像素框：取所有涉及到的词，部分覆盖的词按字符位置截取。 */
function rangeToBox(segments: LineSegment[], range: SensitiveRange): Box | null {
	let box: Box | null = null;
	for (const { word, start, end } of segments) {
		if (end <= range.start || start >= range.end) continue;
		const localStart = Math.max(range.start, start) - start;
		const localEnd = Math.min(range.end, end) - start;
		const left = word.x + word.width * charOffset(word.text, localStart);
		const right = word.x + word.width * charOffset(word.text, localEnd);
		const top = word.y;
		const bottom = word.y + word.height;
		box = box
			? {
					left: Math.min(box.left, left),
					top: Math.min(box.top, top),
					right: Math.max(box.right, right),
					bottom: Math.max(box.bottom, bottom),
					kind: box.kind,
				}
			: { left, top, right, bottom, kind: range.kind };
	}
	return box;
}

/** 外扩一点，盖住字符边缘的抗锯齿；同一行里重叠的框合并成一个。 */
function padAndMerge(boxes: Box[]): Box[] {
	const padded = boxes
		.map((box) => {
			const height = box.bottom - box.top;
			const padX = height * 0.15;
			const padY = height * 0.12;
			return { ...box, left: box.left - padX, right: box.right + padX, top: box.top - padY, bottom: box.bottom + padY };
		})
		.sort((a, b) => a.left - b.left);
	const merged: Box[] = [];
	for (const box of padded) {
		const last = merged[merged.length - 1];
		if (last && box.left <= last.right) {
			last.right = Math.max(last.right, box.right);
			last.top = Math.min(last.top, box.top);
			last.bottom = Math.max(last.bottom, box.bottom);
		} else {
			merged.push({ ...box });
		}
	}
	return merged;
}

/** 在 OCR 结果里找出敏感内容的位置（图片像素），结果限制在图片范围内。 */
export function findSensitiveRegions(
	lines: OcrLine[],
	identity: Identity,
	imageSize?: { width: number; height: number },
): SensitiveRegion[] {
	const regions: SensitiveRegion[] = [];
	for (const line of lines) {
		const { text, segments } = layoutLine(line.words);
		const boxes = findSensitiveRanges(text, identity)
			.map((range) => rangeToBox(segments, range))
			.filter((box): box is Box => box !== null);
		for (const box of padAndMerge(boxes)) {
			const left = Math.max(0, Math.floor(box.left + 1e-6));
			const top = Math.max(0, Math.floor(box.top + 1e-6));
			const right = Math.min(imageSize?.width ?? Infinity, Math.ceil(box.right - 1e-6));
			const bottom = Math.min(imageSize?.height ?? Infinity, Math.ceil(box.bottom - 1e-6));
			if (right - left < 1 || bottom - top < 1) continue;
			regions.push({ x: left, y: top, width: right - left, height: bottom - top, kind: box.kind });
		}
	}
	return regions;
}
