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

/** 窗口枚举的源码，窗口列表工具和截图进程共用。 */
const WINDOW_LIST_SOURCE = path.join(root, "native", "newpath-window-list", "WindowList.swift");

/**
 * name：输出文件名，也是 native/ 下的源码目录（只取目录下第一层的 .swift，不含 tests/）；
 * extraSources：额外一起编译的源码；weakFrameworks：弱链接，老系统上没有这个框架也能启动。
 */
const HELPERS = [
	{ name: "newpath-window-list", frameworks: ["CoreGraphics"] },
	{ name: "newpath-ocr", frameworks: ["Vision", "ImageIO"] },
	{
		name: "newpath-capture-agent",
		extraSources: [WINDOW_LIST_SOURCE],
		frameworks: ["AppKit", "CoreGraphics", "CoreMedia", "CoreVideo", "ImageIO"],
		// SCScreenshotManager 要 macOS 14、SCStream 要 12.3；弱链接后老系统上照样能启动，相应命令回答 unsupported
		weakFrameworks: ["ScreenCaptureKit"],
	},
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
	const files = (await readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".swift"))
		.map((entry) => entry.name)
		.sort();
	return [...files.map((file) => path.join(dir, file)), ...(helper.extraSources ?? [])];
}

async function compile(helper, sources, arch, output) {
	const { stderr } = await exec(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			"-O",
			"-whole-module-optimization",
			"-target",
			`${arch}-apple-macos${MIN_MACOS}`,
			...helper.frameworks.flatMap((framework) => ["-framework", framework]),
			...(helper.weakFrameworks ?? []).flatMap((framework) => ["-Xlinker", "-weak_framework", "-Xlinker", framework]),
			...sources,
			"-o",
			output,
		],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
	// 编译成功时 stderr 里是警告，照样打出来
	if (stderr.trim()) process.stderr.write(stderr);
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
