import { describe, expect, it, vi } from "vitest";
import {
	checkReleaseSignatures,
	isStableRequirement,
	localSigningRequirement,
	parseDesignatedRequirement,
	releaseRequirementFromEnv,
	verifyMacReauthorizedChange,
	verifyMacSigningMigration,
	verifyMacUpdateIdentity,
} from "./mac-signing-policy.mjs";

const source = "/build/NewPath.app";
const target = "/Applications/NewPath.app";
const hash = "89ABCDEF0123456789ABCDEF0123456789ABCDEF";
const adHoc = 'cdhash H"0123456789abcdef0123456789abcdef01234567"';
const stable = `identifier "com.newpath.screenshot" and certificate leaf = H"${hash}"`;

describe("读取签名身份", () => {
	it("解析 node_modules 里 Electron.app 的真实输出（ad-hoc）", () => {
		const output =
			"Executable=/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron\n" +
			'# designated => cdhash H"baef35ea633bba308092dc2b9212b10ce91dcd7c"\n';
		expect(parseDesignatedRequirement(output)).toBe('cdhash H"baef35ea633bba308092dc2b9212b10ce91dcd7c"');
	});

	it("兼容旧版 codesign 不带 # 的写法", () => {
		expect(parseDesignatedRequirement(`designated => ${stable}`)).toBe(stable);
	});

	it("没有签名身份时返回 null", () => {
		expect(parseDesignatedRequirement("Executable=/x\n")).toBeNull();
	});
});

describe("判断固定签名身份", () => {
	it.each([
		[stable, true],
		[`identifier "com.newpath.screenshot" and certificate root = H"${hash.toLowerCase()}"`, true],
		['identifier "x" and anchor apple generic and certificate leaf[subject.OU] = ABCDE12345', true],
		[adHoc, false],
		['identifier "com.newpath.screenshot"', false],
		[null, false],
	])("%s → %s", (requirement, expected) => {
		expect(isStableRequirement(requirement)).toBe(expected);
	});

	it("本机签名钉住叶子证书，哈希统一小写（和 codesign 读回来的一致）", () => {
		expect(localSigningRequirement("com.newpath.screenshot", hash)).toBe(
			`identifier "com.newpath.screenshot" and certificate leaf = H"${hash.toLowerCase()}"`,
		);
		expect(isStableRequirement(localSigningRequirement("com.newpath.screenshot", hash))).toBe(true);
		expect(() => localSigningRequirement("com.newpath.screenshot", "NewPath Signing")).toThrow("SHA-1");
	});

	it("发布签名身份来自 NEWPATH_RELEASE_REQUIREMENT，空白视为未设置", () => {
		expect(releaseRequirementFromEnv({ NEWPATH_RELEASE_REQUIREMENT: ` ${stable} ` })).toBe(stable);
		expect(releaseRequirementFromEnv({ NEWPATH_RELEASE_REQUIREMENT: "  " })).toBeNull();
		expect(releaseRequirementFromEnv({})).toBeNull();
	});
});

describe("原位更新前校验签名身份", () => {
	it.each(["stdout", "stderr"])("从 %s 读出已安装应用的签名身份", async (stream) => {
		const requirement = 'identifier "com.newpath.screenshot" and anchor apple generic';
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ [stream]: `Executable=${target}\n# designated => ${requirement}\n` })
			.mockResolvedValueOnce({});
		await expect(verifyMacUpdateIdentity(source, target, run)).resolves.toBe(requirement);
		expect(run).toHaveBeenLastCalledWith("codesign", ["--verify", "--deep", "--strict", `-R=${requirement}`, source]);
	});

	it("ad-hoc 的签名身份也照样校验，不跳过", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${adHoc}` })
			.mockResolvedValueOnce({});
		await expect(verifyMacUpdateIdentity(source, target, run)).resolves.toBe(adHoc);
		expect(run.mock.calls[2][1]).toContain(`-R=${adHoc}`);
	});

	it("应用名相同但签名身份变了时拒绝", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"old"' })
			.mockRejectedValueOnce(new Error("failed to satisfy code requirement(s)"));
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("停止替换");
	});

	it("读不到已安装应用的签名身份时拒绝", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stdout: "", stderr: `Executable=${target}` });
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("无法读取");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("已安装应用签名无效时不信任它", async () => {
		const run = vi.fn().mockRejectedValueOnce(new Error("invalid signature"));
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("invalid signature");
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe("一次性迁移到固定签名身份", () => {
	it("允许把 ad-hoc 安装换成证书签名的新包", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${adHoc}` })
			.mockResolvedValueOnce({ stderr: `# designated => ${stable}` })
			.mockResolvedValueOnce({});
		await expect(verifyMacSigningMigration(source, target, run)).resolves.toEqual({ from: adHoc, to: stable });
		expect(run).toHaveBeenLastCalledWith("codesign", ["--verify", "--deep", "--strict", `-R=${stable}`, source]);
	});

	it("新包仍是 ad-hoc 时拒绝", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${adHoc}` })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"fedcba"' });
		await expect(verifyMacSigningMigration(source, target, run)).rejects.toThrow("没有使用固定签名");
	});

	it("已安装的已经是固定签名时拒绝迁移", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${stable}` });
		await expect(verifyMacSigningMigration(source, target, run)).rejects.toThrow("已使用固定签名");
	});
});

describe("用户接受重新授权", () => {
	it("记录前后两个签名身份，并仍然校验新包", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"old"' })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"new"' })
			.mockResolvedValueOnce({});
		await expect(verifyMacReauthorizedChange(source, target, run)).resolves.toEqual({
			from: 'cdhash H"old"',
			to: 'cdhash H"new"',
			acceptedReauthorization: true,
		});
		expect(run).toHaveBeenLastCalledWith("codesign", ["--verify", "--deep", "--strict", '-R=cdhash H"new"', source]);
	});

	it("读不到签名身份时停止", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: "" })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"new"' });
		await expect(verifyMacReauthorizedChange(source, target, run)).rejects.toThrow("无法读取");
	});
});

describe("CI 验签", () => {
	const arm = "/release/0.1.0/mac-arm64/NewPath.app";
	const intel = "/release/0.1.0/mac/NewPath.app";

	/** 按应用路径返回签名身份；verify 调用时 failVerify 里的应用失败。 */
	function codesign(requirements, failVerify = []) {
		return vi.fn(async (_command, args) => {
			const app = args.at(-1);
			if (args[0] === "-d") return { stderr: `Executable=${app}\n# designated => ${requirements[app]}\n` };
			if (failVerify.includes(app) && args.some((arg) => arg.startsWith("-R="))) throw new Error("failed to satisfy");
			return {};
		});
	}

	it("没配证书时 ad-hoc 包跳过检查并说明", async () => {
		const run = codesign({ [arm]: adHoc, [intel]: 'cdhash H"fedcba9876543210fedcba9876543210fedcba98"' });
		const result = await checkReleaseSignatures([arm, intel], { run });
		expect(result.skipped).toBe(true);
		expect(result.reason).toContain("ad-hoc");
	});

	it("跳过时也要求签名本身有效", async () => {
		const run = vi.fn().mockRejectedValueOnce(new Error("code object is not signed at all"));
		await expect(checkReleaseSignatures([arm], { run })).rejects.toThrow("not signed");
	});

	it("配了证书却退回 ad-hoc 时失败", async () => {
		const run = codesign({ [arm]: adHoc });
		await expect(checkReleaseSignatures([arm], { expectCertificate: true, run })).rejects.toThrow("没有使用固定签名");
	});

	it("一个架构是证书签名、另一个是 ad-hoc 时失败", async () => {
		const run = codesign({ [arm]: stable, [intel]: adHoc });
		await expect(checkReleaseSignatures([arm, intel], { run })).rejects.toThrow(intel);
	});

	it("没设置发布签名身份时要求各架构一致", async () => {
		const other = `identifier "com.newpath.screenshot" and certificate root = H"${"1".repeat(40)}"`;
		await expect(checkReleaseSignatures([arm, intel], { run: codesign({ [arm]: stable, [intel]: other }) })).rejects.toThrow(
			"不一致",
		);
		const result = await checkReleaseSignatures([arm, intel], { run: codesign({ [arm]: stable, [intel]: stable }) });
		expect(result).toMatchObject({ skipped: false, requirement: null });
	});

	it("设置了发布签名身份时每个包都要满足它", async () => {
		const run = codesign({ [arm]: stable, [intel]: stable });
		await expect(checkReleaseSignatures([arm, intel], { requirement: stable, run })).resolves.toMatchObject({ skipped: false });
		expect(run).toHaveBeenCalledWith("codesign", ["--verify", "--deep", "--strict", `-R=${stable}`, intel]);
	});

	it("不满足发布签名身份时失败", async () => {
		const run = codesign({ [arm]: stable, [intel]: stable }, [intel]);
		await expect(checkReleaseSignatures([arm, intel], { requirement: stable, run })).rejects.toThrow("不满足发布签名身份");
	});

	it("设置了发布签名身份时 ad-hoc 包不会被跳过", async () => {
		const run = codesign({ [arm]: adHoc });
		await expect(checkReleaseSignatures([arm], { requirement: stable, run })).rejects.toThrow("没有使用固定签名");
	});
});
