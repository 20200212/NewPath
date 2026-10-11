import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** macOS 上随应用分发的 Swift 小工具，源码在 native/，由 scripts/build-native.mjs 编译。 */
export type NativeHelper = "newpath-window-list" | "newpath-ocr";

/** 打包后在 Resources/native/ 下；开发模式用 build/native/ 里刚编译出来的。找不到时返回 null。 */
export function nativeHelperPath(name: NativeHelper): string | null {
	const file = app.isPackaged
		? path.join(process.resourcesPath, "native", name)
		: path.join(app.getAppPath(), "build", "native", name);
	return fs.existsSync(file) ? file : null;
}

/** 运行一次小工具，返回 stdout。 */
export function runNativeHelper(file: string, args: string[], timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error) reject(new Error(stderr.trim() || error.message));
			else resolve(stdout);
		});
	});
}
