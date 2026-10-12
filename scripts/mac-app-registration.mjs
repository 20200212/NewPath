import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { BUNDLE_ID } from "./mac-app.mjs";

// 让 LaunchServices 里只剩一份 NewPath 的注册。同一个 Bundle ID 注册了多份副本时，
// 系统可能按旧副本的路径和签名身份去核对屏幕录制授权，表现为“已经授权了还一直弹窗”。

const exec = promisify(execFile);
const launchServices = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const listScript = path.join(import.meta.dirname, "list-mac-app-registrations.swift");

/** 校验 list-mac-app-registrations.swift 的输出：{ preferred: string | null, registered: string[] }，路径都是绝对路径。 */
export function parseRegistrations(stdout) {
	const result = JSON.parse(stdout);
	if (
		!Array.isArray(result.registered) ||
		result.registered.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry)) ||
		(result.preferred != null && (typeof result.preferred !== "string" || !path.isAbsolute(result.preferred)))
	) {
		throw new Error("NewPath 应用注册信息格式不对");
	}
	return { preferred: result.preferred ?? null, registered: result.registered };
}

export async function listNewPathRegistrations(run = exec) {
	const { stdout } = await run("/usr/bin/swift", [listScript, BUNDLE_ID]);
	return parseRegistrations(stdout);
}

export async function registerOnlyInstalledNewPath(target, run = exec) {
	const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(target, "Contents/Info.plist")]);
	if (stdout.trim() !== BUNDLE_ID) throw new Error("已安装应用的 Bundle ID 不对");
	const before = await listNewPathRegistrations(run);
	const removedRegistrations = [...new Set(before.registered)].filter((entry) => entry !== target);
	for (const appPath of removedRegistrations) {
		await run(launchServices, ["-u", appPath]);
	}
	await run(launchServices, ["-f", target]);
	const after = await listNewPathRegistrations(run);
	if (after.preferred !== target || after.registered.some((entry) => entry !== target) || !after.registered.includes(target)) {
		throw new Error(`NewPath 的应用注册仍有多份：${JSON.stringify(after)}`);
	}
	return { target, removedRegistrations, ...after };
}
