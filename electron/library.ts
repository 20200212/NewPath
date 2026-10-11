import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { mt } from "./i18n";
import type { ScreenshotItem } from "./ipcTypes";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 200;

export function isImageFile(name: string): boolean {
	return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** 把渲染进程传来的文件名解析成截图库里的完整路径；含路径分隔符或 . / .. 时拒绝，防止越权访问其他目录。 */
export function resolveInDir(dir: string, name: unknown): string | null {
	if (typeof name !== "string" || !name || name === "." || name === "..") return null;
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
	return path.join(dir, name);
}

export type FileNameResult = { ok: true; name: string } | { ok: false; reason: string };

/** 校验重命名的新名字，扩展名始终沿用原文件的（用户输入里带了同样的扩展名也可以）。 */
export function validateFileName(input: unknown, original: string): FileNameResult {
	if (typeof input !== "string") return { ok: false, reason: mt().invalidFileName };
	const ext = path.extname(original);
	let base = input.trim();
	if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) base = base.slice(0, -ext.length).trimEnd();
	if (!base) return { ok: false, reason: mt().fileNameEmpty };
	if (INVALID_CHARS.test(base)) return { ok: false, reason: mt().fileNameInvalidChars };
	if (/[. ]$/.test(base)) return { ok: false, reason: mt().fileNameTrailing };
	if (RESERVED_NAMES.test(base)) return { ok: false, reason: mt().fileNameReserved };
	if (base.length > MAX_NAME_LENGTH) return { ok: false, reason: mt().fileNameTooLong };
	return { ok: true, name: base + ext };
}

/** 重名时依次尝试 名字 (1).png、名字 (2).png……（不区分大小写，和 Windows 一致）。 */
export function uniqueFileName(name: string, existing: Iterable<string>): string {
	const taken = new Set(Array.from(existing, (item) => item.toLowerCase()));
	if (!taken.has(name.toLowerCase())) return name;
	const ext = path.extname(name);
	const base = name.slice(0, name.length - ext.length);
	for (let i = 1; ; i++) {
		const candidate = `${base} (${i})${ext}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
}

/** 列出目录里的图片，最新的在前。目录不存在时返回空列表。 */
export async function listScreenshots(dir: string): Promise<ScreenshotItem[]> {
	let entries: fs.Dirent[];
	try {
		entries = await fsp.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const items = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && isImageFile(entry.name))
			.map(async (entry): Promise<ScreenshotItem | null> => {
				try {
					const stat = await fsp.stat(path.join(dir, entry.name));
					return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
				} catch {
					return null;
				}
			}),
	);
	return items.filter((item): item is ScreenshotItem => item !== null).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 把 PNG 写进截图库，自动避开重名，返回完整路径。 */
export async function saveToLibrary(dir: string, name: string, png: Buffer): Promise<string> {
	await fsp.mkdir(dir, { recursive: true });
	const target = path.join(dir, uniqueFileName(name, await fsp.readdir(dir)));
	await fsp.writeFile(target, png, { flag: "wx" });
	return target;
}

/** 监听目录变化（防抖），返回停止监听的函数。 */
export function watchDir(dir: string, onChange: () => void, delayMs = 200): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watcher: fs.FSWatcher | undefined;
	try {
		fs.mkdirSync(dir, { recursive: true });
		watcher = fs.watch(dir, () => {
			clearTimeout(timer);
			timer = setTimeout(onChange, delayMs);
		});
		// 目录被删除等情况下 watcher 会报错，忽略即可，下次更换目录时会重新监听
		watcher.on("error", () => watcher?.close());
	} catch (error) {
		console.warn(`无法监听目录 ${dir}`, error);
	}
	return () => {
		clearTimeout(timer);
		watcher?.close();
	};
}
