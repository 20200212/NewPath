import { describe, expect, it } from "vitest";
import { launchCommandFromArgs } from "./launchArgs";

describe("launchCommandFromArgs", () => {
	it("认出截图、滚动截图、引导和主界面的命令", () => {
		expect(launchCommandFromArgs(["/Applications/NewPath.app/Contents/MacOS/NewPath", "--capture-region"])).toBe("capture");
		expect(launchCommandFromArgs(["electron", ".", "--capture"])).toBe("capture");
		expect(launchCommandFromArgs(["NewPath", "--capture-scroll"])).toBe("capture-scroll");
		expect(launchCommandFromArgs(["NewPath", "--onboarding"])).toBe("onboarding");
		expect(launchCommandFromArgs(["NewPath", "--show"])).toBe("show");
	});

	it("没有命令或只有其他参数时返回 null", () => {
		expect(launchCommandFromArgs(["NewPath"])).toBeNull();
		expect(launchCommandFromArgs(["NewPath", "--hidden", "--newpath-onboarding=done"])).toBeNull();
	});
});
