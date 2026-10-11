const UNITS = ["B", "KB", "MB", "GB"];

/** 124 KB、2.4 MB 这样的大小文本：小于 10 保留一位小数。 */
export function formatBytes(bytes: number): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
	return `${text} ${UNITS[unit]}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** 本地时间，格式 2026/10/11 15:30。 */
export function formatDate(ms: number): string {
	const date = new Date(ms);
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
