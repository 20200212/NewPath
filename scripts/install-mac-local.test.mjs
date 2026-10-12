import path from "node:path";
import { describe, expect, it } from "vitest";
import { packagedFilesToCheck, parseInstallArgs, parseRunningApps } from "./install-mac-local.mjs";
import { INSTALL_TARGET, builtAppPath } from "./mac-app.mjs";

describe("安装参数", () => {
	it("默认不带参数：常规安装", () => {
		expect(parseInstallArgs([])).toEqual({ checkOnly: false, migrateSigning: false, acceptReauthorization: false, source: null });
	});

	it("可以指定新包路径并同时只检查", () => {
		expect(parseInstallArgs(["--check", "/tmp/NewPath.app", "--migrate-signing"])).toEqual({
			checkOnly: true,
			migrateSigning: true,
			acceptReauthorization: false,
			source: "/tmp/NewPath.app",
		});
	});

	it.each([
		[["--migrate-signing", "--accept-reauthorization"]],
		[["a.app", "b.app"]],
		[["--force"]],
	])("拒绝 %j", (args) => {
		expect(() => parseInstallArgs(args)).toThrow("用法");
	});
});

describe("构建产物和安装位置", () => {
	it("Apple 芯片用 mac-arm64，Intel 用 mac", () => {
		expect(builtAppPath("/repo", "0.1.0", "arm64")).toBe(path.join("/repo", "release", "0.1.0", "mac-arm64", "NewPath.app"));
		expect(builtAppPath("/repo", "0.1.0", "x64")).toBe(path.join("/repo", "release", "0.1.0", "mac", "NewPath.app"));
	});

	it("固定安装到 /Applications/NewPath.app", () => {
		expect(INSTALL_TARGET).toBe(path.join("/Applications", "NewPath.app"));
	});
});

describe("找正在运行的 NewPath", () => {
	it("只认主进程，不认 Helper 和同名前缀的其他应用", () => {
		const output = [
			"  101 /Applications/NewPath.app/Contents/MacOS/NewPath",
			"  102 /Applications/NewPath.app/Contents/Frameworks/NewPath Helper (Renderer).app/Contents/MacOS/NewPath Helper (Renderer)",
			"  103 /Users/me/My Apps/NewPath.app/Contents/MacOS/NewPath",
			"  104 /Applications/NewPathPro.app/Contents/MacOS/NewPathPro",
			"  105 /Applications/NewPath.app/Contents/Resources/native/newpath-window-list",
			"",
		].join("\n");
		expect(parseRunningApps(output)).toEqual([
			{ pid: 101, appPath: "/Applications/NewPath.app" },
			{ pid: 103, appPath: "/Users/me/My Apps/NewPath.app" },
		]);
	});
});

describe("与本次构建比对的包内文件", () => {
	it("包括页面、主进程、preload 和渲染进程入口", () => {
		const entries = ["/dist", "/dist/index.html", "/dist/assets", "/dist/assets/index-AbC123.js", "/dist/assets/index-AbC123.css", "/dist-electron/main.js"];
		expect(packagedFilesToCheck(entries)).toEqual([
			"dist/index.html",
			"dist-electron/main.js",
			"dist-electron/preload.mjs",
			"dist/assets/index-AbC123.js",
		]);
	});

	it("兼容 Windows 风格的分隔符", () => {
		expect(packagedFilesToCheck(["\\dist\\assets\\index-x.js"]).at(-1)).toBe("dist/assets/index-x.js");
	});

	it("找不到渲染进程入口时报错", () => {
		expect(() => packagedFilesToCheck(["/dist/index.html", "/dist/assets/vendor-x.js"])).toThrow("渲染进程入口");
	});
});
