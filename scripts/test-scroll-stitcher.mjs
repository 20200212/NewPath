import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// 编译并运行滚动拼接（native/newpath-capture-agent/ScrollStitcher.swift）的测试，输出到 build/tests/。
// 拼接是纯逻辑，测试只编译它和 tests/main.swift，不需要屏幕录制权限。不在 macOS 上时直接跳过。

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const agentDir = path.join(root, "native", "newpath-capture-agent");
const outDir = path.join(root, "build", "tests");
const executable = path.join(outDir, "scroll-stitcher-tests");
const MAX_BUFFER = 4 * 1024 * 1024;

if (process.platform !== "darwin") {
	console.log("[test-scroll-stitcher] 不在 macOS 上，跳过");
	process.exit(0);
}

await mkdir(outDir, { recursive: true });
try {
	await exec(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			"-O",
			path.join(agentDir, "ScrollStitcher.swift"),
			path.join(agentDir, "tests", "main.swift"),
			"-o",
			executable,
		],
		{ maxBuffer: MAX_BUFFER },
	);
} catch (error) {
	process.stderr.write(error.stderr ?? String(error));
	process.exit(1);
}
try {
	const { stdout } = await exec(executable, [], { maxBuffer: MAX_BUFFER });
	process.stdout.write(stdout);
} catch (error) {
	process.stdout.write(error.stdout ?? "");
	process.stderr.write(error.stderr ?? "");
	process.exitCode = 1;
}
