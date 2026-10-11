import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "./ipcTypes";
import { isLanguageSetting } from "./locale";

/** 字段缺失或类型不对时回退到默认值，保证旧版本或手改坏的配置文件也能启动。 */
export function normalizeSettings(raw: unknown, defaults: AppSettings): AppSettings {
	const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const pick = (key: "captureShortcut" | "saveDir") => {
		const item = value[key];
		return typeof item === "string" && item.trim() ? item.trim() : defaults[key];
	};
	return {
		captureShortcut: pick("captureShortcut"),
		saveDir: pick("saveDir"),
		language: isLanguageSetting(value.language) ? value.language : defaults.language,
	};
}

export async function loadSettings(file: string, defaults: AppSettings): Promise<AppSettings> {
	try {
		return normalizeSettings(JSON.parse(await fs.readFile(file, "utf8")), defaults);
	} catch {
		return { ...defaults };
	}
}

export async function saveSettings(file: string, settings: AppSettings): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	// 先写临时文件再改名，避免写到一半崩溃留下损坏的配置
	const temp = `${file}.tmp`;
	await fs.writeFile(temp, JSON.stringify(settings, null, "\t"), "utf8");
	await fs.rename(temp, file);
}
