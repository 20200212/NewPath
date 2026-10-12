import { describe, expect, it, vi } from "vitest";
import { parseRegistrations, registerOnlyInstalledNewPath } from "./mac-app-registration.mjs";

const target = "/Applications/NewPath.app";
const old = "/Users/example/Downloads/NewPath.app";

function mockRegistration(before, after) {
	let listings = 0;
	return vi.fn(async (command) => {
		if (command.endsWith("PlistBuddy")) return { stdout: "com.newpath.screenshot\n" };
		if (command === "/usr/bin/swift") return { stdout: JSON.stringify(listings++ === 0 ? before : after) };
		return { stdout: "" };
	});
}

describe("NewPath 应用注册", () => {
	it("撤销重复副本的注册，保留安装位置的注册", async () => {
		const run = mockRegistration({ preferred: old, registered: [old, target, old] }, { preferred: target, registered: [target] });
		const result = await registerOnlyInstalledNewPath(target, run);
		expect(result.removedRegistrations).toEqual([old]);
		expect(run.mock.calls.filter(([, args]) => args[0] === "-u").map(([, args]) => args[1])).toEqual([old]);
		expect(run).toHaveBeenCalledWith(expect.stringContaining("lsregister"), ["-f", target]);
	});

	it("查询注册时用 NewPath 的 Bundle ID", async () => {
		const run = mockRegistration({ preferred: target, registered: [target] }, { preferred: target, registered: [target] });
		await registerOnlyInstalledNewPath(target, run);
		const swift = run.mock.calls.find(([command]) => command === "/usr/bin/swift");
		expect(swift[1][0]).toMatch(/list-mac-app-registrations\.swift$/);
		expect(swift[1][1]).toBe("com.newpath.screenshot");
	});

	it("改动注册前先核对目标的 Bundle ID", async () => {
		const run = vi.fn().mockResolvedValue({ stdout: "com.example.other" });
		await expect(registerOnlyInstalledNewPath(target, run)).rejects.toThrow("Bundle ID");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("仍有多份注册时报错", async () => {
		const state = { preferred: target, registered: [target, old] };
		await expect(registerOnlyInstalledNewPath(target, mockRegistration(state, state))).rejects.toThrow("仍有多份");
	});

	it("路径格式不对时什么都不撤销", async () => {
		const run = mockRegistration({ registered: ["relative.app"] }, {});
		await expect(registerOnlyInstalledNewPath(target, run)).rejects.toThrow("格式不对");
		expect(run.mock.calls.some(([, args]) => args[0] === "-u")).toBe(false);
	});

	it("解析注册列表：preferred 可以为空，但不能是相对路径", () => {
		expect(parseRegistrations('{"preferred":null,"registered":[]}')).toEqual({ preferred: null, registered: [] });
		expect(() => parseRegistrations('{"preferred":"NewPath.app","registered":[]}')).toThrow("格式不对");
		expect(() => parseRegistrations('{"preferred":null}')).toThrow("格式不对");
	});
});
