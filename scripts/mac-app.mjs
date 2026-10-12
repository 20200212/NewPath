import path from "node:path";

// 本机签名、安装脚本共用的应用信息，与 electron-builder.json5 的 appId / productName 保持一致。

export const APP_NAME = "NewPath";
export const BUNDLE_ID = "com.newpath.screenshot";
/** 固定的安装位置，与 DMG 拖入的位置一致。 */
export const INSTALL_TARGET = path.join("/Applications", `${APP_NAME}.app`);
/** 主进程可执行文件相对 .app 的路径，用于在进程列表里认出 NewPath。 */
export const MAIN_EXECUTABLE = `/Contents/MacOS/${APP_NAME}`;

/**
 * electron-builder `--dir` 打出的 .app 所在位置：
 * Apple 芯片是 release/<版本>/mac-arm64/，Intel 是 release/<版本>/mac/。
 */
export function builtAppPath(root, version, arch = process.arch) {
	const folder = arch === "arm64" ? "mac-arm64" : "mac";
	return path.join(root, "release", version, folder, `${APP_NAME}.app`);
}
