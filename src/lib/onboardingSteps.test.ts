import { describe, expect, it } from "vitest";
import { isPermissionGranted, nextOnboardingStep, onboardingSteps, previousOnboardingStep } from "./onboardingSteps";

describe("onboardingSteps", () => {
	it("macOS 上多一步授权", () => {
		expect(onboardingSteps(true)).toEqual(["welcome", "permission", "done"]);
		expect(onboardingSteps(false)).toEqual(["welcome", "done"]);
	});

	it("下一步到最后一步为止", () => {
		const steps = onboardingSteps(true);
		expect(nextOnboardingStep(steps, "welcome")).toBe("permission");
		expect(nextOnboardingStep(steps, "permission")).toBe("done");
		expect(nextOnboardingStep(steps, "done")).toBeNull();
	});

	it("不在列表里的步骤当作第一步", () => {
		expect(nextOnboardingStep(onboardingSteps(false), "permission")).toBe("done");
		expect(previousOnboardingStep(onboardingSteps(false), "permission")).toBeNull();
	});

	it("上一步到第一步为止", () => {
		const steps = onboardingSteps(false);
		expect(previousOnboardingStep(steps, "done")).toBe("welcome");
		expect(previousOnboardingStep(steps, "welcome")).toBeNull();
	});

	it("只有 granted 算授权", () => {
		expect(isPermissionGranted("granted")).toBe(true);
		for (const permission of ["not-determined", "denied", "restricted", "unknown"] as const) {
			expect(isPermissionGranted(permission)).toBe(false);
		}
	});
});
