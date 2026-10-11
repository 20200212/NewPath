import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// 编译 native/ 下 macOS 用的 Swift 小工具，输出到 build/native/，打包时由 electron-builder 的 extraResources 带上。
//   node scripts/build-native.mjs          编译 arm64 + x86_64 的通用二进制（打包用，每次都重新编译）
//   node scripts/build-native.mjs --host   只编译当前架构，源码没变时跳过（开发时用）
// 不在 macOS 上时直接跳过：Windows 版不需要这些工具。

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "build", "native");
/** 与 Electron 39 支持的最低系统版本一致。 */
const MIN_MACOS = "12.0";
const ARCHS = { arm64: "arm64", x64: "x86_64" };

const HELPERS = [
	{ name: "newpath-window-list", frameworks: ["CoreGraphics"] },
	{ name: "newpath-ocr", frameworks: ["Vision", "ImageIO"] },
];

if (process.platform !== "darwin") {
	console.log("[build-native] 不在 macOS 上，跳过 Swift 工具的编译");
	process.exit(0);
}

const hostOnly = process.argv.includes("--host");

async function mtime(file) {
	try {
		return (await stat(file)).mtimeMs;
	} catch {
		return 0;
	}
}

async function sourcesOf(helper) {
	const dir = path.join(root, "native", helper.name);
	const files = (await readdir(dir)).filter((file) => file.endsWith(".swift")).sort();
	return files.map((file) => path.join(dir, file));
}

async function compile(helper, sources, arch, output) {
	await exec("xcrun", [
		"--sdk",
		"macosx",
		"swiftc",
		"-O",
		"-target",
		`${arch}-apple-macos${MIN_MACOS}`,
		...helper.frameworks.flatMap((framework) => ["-framework", framework]),
		...sources,
		"-o",
		output,
	]);
}

async function build(helper) {
	const sources = await sourcesOf(helper);
	const output = path.join(outDir, helper.name);
	if (hostOnly) {
		const newest = Math.max(...(await Promise.all([...sources, import.meta.filename].map(mtime))));
		if ((await mtime(output)) > newest) {
			console.log(`[build-native] ${helper.name} 已是最新`);
			return;
		}
		await compile(helper, sources, ARCHS[process.arch] ?? process.arch, output);
		console.log(`[build-native] ${helper.name}（${process.arch}）`);
		return;
	}

	// 两种架构分别编译，再用 lipo 合成一个通用二进制
	const slices = [];
	for (const arch of Object.values(ARCHS)) {
		const slice = `${output}-${arch}`;
		await compile(helper, sources, arch, slice);
		slices.push(slice);
	}
	await exec("lipo", ["-create", "-output", output, ...slices]);
	await Promise.all(slices.map((slice) => rm(slice, { force: true })));
	console.log(`[build-native] ${helper.name}（universal）`);
}

await mkdir(outDir, { recursive: true });
for (const helper of HELPERS) await build(helper);
