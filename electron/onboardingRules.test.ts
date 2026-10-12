import { describe, expect, it } from "vitest";
import { placePermissionHelper, relaunchStepFromArgs } from "./onboardingRules";

describe("relaunchStepFromArgs", () => {
	it("读出重启后要停的步骤", () => {
		expect(relaunchStepFromArgs(["NewPath", "--newpath-onboarding=done"])).toBe("done");
		expect(relaunchStepFromArgs(["NewPath", "--newpath-onboarding=permission"])).toBe("permission");
	});

	it("不认识的步骤或没有参数时返回 null", () => {
		expect(relaunchStepFromArgs(["NewPath", "--newpath-onboarding=evil"])).toBeNull();
		expect(relaunchStepFromArgs(["NewPath"])).toBeNull();
	});
});

describe("placePermissionHelper", () => {
	const workArea = { x: 0, y: 25, width: 1512, height: 957 };

	it("放在系统设置窗口正下方、水平居中", () => {
		expect(placePermissionHelper({ x: 300, y: 100, width: 800, height: 600 }, workArea)).toEqual({ x: 500, y: 710 });
	});

	it("下面没地方时收进窗口底部", () => {
		expect(placePermissionHelper({ x: 300, y: 300, width: 800, height: 660 }, workArea)).toEqual({ x: 500, y: 848 });
	});

	it("不超出屏幕左右边缘", () => {
		expect(placePermissionHelper({ x: -100, y: 100, width: 300, height: 400 }, workArea).x).toBe(8);
		expect(placePermissionHelper({ x: 1400, y: 100, width: 300, height: 400 }, workArea).x).toBe(1512 - 400 - 8);
	});
});
