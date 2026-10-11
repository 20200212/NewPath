// 生成占位图标 public/icon.png（512×512），之后可直接替换成正式设计稿。
// 用法：node scripts/generate-icon.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512;

function crc32(buffer) {
	let crc = ~0;
	for (const byte of buffer) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return ~crc >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** 圆角矩形渐变底 + 白色取景框四角。 */
function pixel(x, y) {
	const radius = SIZE * 0.22;
	const cx = Math.min(Math.max(x, radius), SIZE - radius);
	const cy = Math.min(Math.max(y, radius), SIZE - radius);
	if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return [0, 0, 0, 0];

	const inset = SIZE * 0.24;
	const arm = SIZE * 0.16;
	const stroke = SIZE * 0.05;
	const nearX = Math.min(Math.abs(x - inset), Math.abs(x - (SIZE - inset)));
	const nearY = Math.min(Math.abs(y - inset), Math.abs(y - (SIZE - inset)));
	const inBox = x >= inset - stroke / 2 && x <= SIZE - inset + stroke / 2 && y >= inset - stroke / 2 && y <= SIZE - inset + stroke / 2;
	const alongX = Math.min(x - inset, SIZE - inset - x) < arm;
	const alongY = Math.min(y - inset, SIZE - inset - y) < arm;
	if (inBox && ((nearX < stroke / 2 && alongY) || (nearY < stroke / 2 && alongX))) return [255, 255, 255, 255];

	const t = (x + y) / (2 * SIZE);
	return [Math.round(14 + t * 110), Math.round(165 - t * 90), Math.round(233 - t * 20), 255];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
	raw[y * (SIZE * 4 + 1)] = 0;
	for (let x = 0; x < SIZE; x++) {
		const offset = y * (SIZE * 4 + 1) + 1 + x * 4;
		raw.set(pixel(x + 0.5, y + 0.5), offset);
	}
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk("IHDR", header),
	chunk("IDAT", deflateSync(raw)),
	chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../public/icon.png", import.meta.url), png);
console.log("public/icon.png 已生成");
