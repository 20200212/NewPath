import { mt } from "./i18n";

const pad = (value: number) => String(value).padStart(2, "0");

/** 默认文件名，例如 截图 2026-10-11 153045.png（前缀随界面语言，不含 Windows 文件名非法字符）。 */
export function defaultScreenshotName(date = new Date()): string {
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `${mt().screenshotFilePrefix} ${day} ${time}.png`;
}

/** 保存对话框可能返回不带扩展名的路径，统一补上 .png。 */
export function ensurePngExtension(filePath: string): string {
	return /\.png$/i.test(filePath) ? filePath : `${filePath}.png`;
}
