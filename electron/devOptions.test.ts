import path from "node:path";
import { describe, expect, it } from "vitest";
import { devPermissionHost, readDevOptions } from "./devOptions";

const APP_DATA = "/Users/me/Library/Application Support";

describe("readDevOptions", () => {
	it("打包后忽略所有开发用的环境变量", () => {
		const options = readDevOptions(
			{ NEWPATH_USER_DATA_DIR: "/tmp/x", NEWPATH_DEV_CAPTURE_FILE: "a.png", NEWPATH_DEV_SHORTCUT: "0" },
			true,
			APP_DATA,
		);
		expect(options).toEqual({
			userDataDir: null,
			captureFile: null,
			scrollFixture: null,
			shortcutEnabled: true,
			remoteDebuggingPort: null,
			settingsBundle: null,
		});
	});

	it("开发模式默认用独立的数据目录、注册快捷键", () => {
		const options = readDevOptions({}, false, APP_DATA);
		expect(options.userDataDir).toBe(path.join(APP_DATA, "NewPath Dev"));
		expect(options.shortcutEnabled).toBe(true);
		expect(options.captureFile).toBeNull();
	});

	it("读取并规范化开发用的环境变量", () => {
		const options = readDevOptions(
			{
				NEWPATH_USER_DATA_DIR: "/tmp/newpath-dev",
				NEWPATH_DEV_CAPTURE_FILE: "/tmp/screen.png",
				NEWPATH_DEV_SCROLL_FIXTURE: "/tmp/tall.png",
				NEWPATH_DEV_SHORTCUT: "Off",
				NEWPATH_DEV_REMOTE_DEBUGGING_PORT: "9222",
				NEWPATH_DEV_SETTINGS_BUNDLE: "com.apple.TextEdit",
			},
			false,
			APP_DATA,
		);
		expect(options).toEqual({
			userDataDir: path.resolve("/tmp/newpath-dev"),
			captureFile: path.resolve("/tmp/screen.png"),
			scrollFixture: path.resolve("/tmp/tall.png"),
			shortcutEnabled: false,
			remoteDebuggingPort: "9222",
			settingsBundle: "com.apple.TextEdit",
		});
	});

	it("不合法的端口号和空值被忽略", () => {
		const options = readDevOptions(
			{ NEWPATH_DEV_REMOTE_DEBUGGING_PORT: "abc", NEWPATH_DEV_CAPTURE_FILE: "  ", NEWPATH_DEV_SHORTCUT: "1" },
			false,
			APP_DATA,
		);
		expect(options.remoteDebuggingPort).toBeNull();
		expect(options.captureFile).toBeNull();
		expect(options.shortcutEnabled).toBe(true);
	});
});

describe("devPermissionHost", () => {
	it("按启动它的应用的 Bundle ID 给出名字", () => {
		expect(devPermissionHost({ __CFBundleIdentifier: "com.apple.Terminal", TERM_PROGRAM: "Apple_Terminal" })).toEqual({
			bundleId: "com.apple.Terminal",
			name: "Terminal",
		});
		expect(devPermissionHost({ __CFBundleIdentifier: "com.example.Unknown" })).toEqual({
			bundleId: "com.example.Unknown",
			name: "com.example.Unknown",
		});
	});

	it("没有 Bundle ID 时退回 TERM_PROGRAM", () => {
		expect(devPermissionHost({ TERM_PROGRAM: "iTerm.app" })).toEqual({ bundleId: null, name: "iTerm" });
	});

	it("由 Electron 自己或访达启动时返回 null", () => {
		expect(devPermissionHost({ __CFBundleIdentifier: "com.github.Electron" })).toBeNull();
		expect(devPermissionHost({})).toBeNull();
	});
});
