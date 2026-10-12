import { describe, expect, it } from "vitest";
import { findSigningIdentity, hasHardenedRuntime, nativeHelperTargets } from "./sign-mac-local.mjs";

const local = "89ABCDEF0123456789ABCDEF0123456789ABCDEF";
const dev = "88155DAE4054D45E2A25EBDD8FD407342BF7EC51";
// `security find-identity -p codesigning` 的格式：同一张证书会在“Valid identities only”里再列一次，
// 自签名证书带 CSSMERR_TP_NOT_TRUSTED 且不出现在有效列表里
const findIdentityOutput = `
Policy: Code Signing
  Matching identities
  1) ${dev} "Apple Development: Someone (UD972VX8SL)"
  2) ${local} "NewPath Signing" (CSSMERR_TP_NOT_TRUSTED)
     2 identities found

  Valid identities only
  1) ${dev} "Apple Development: Someone (UD972VX8SL)"
     1 valid identities found
`;

describe("找签名证书", () => {
	it("按名称找到不受信任的自签名证书", () => {
		expect(findSigningIdentity(findIdentityOutput, "NewPath Signing")).toEqual({ hash: local, name: "NewPath Signing" });
	});

	it("按 SHA-1 找，大小写不敏感；同一张证书列两次不算歧义", () => {
		expect(findSigningIdentity(findIdentityOutput, dev.toLowerCase())).toEqual({
			hash: dev,
			name: "Apple Development: Someone (UD972VX8SL)",
		});
	});

	it("名称要完全匹配，不按子串", () => {
		expect(() => findSigningIdentity(findIdentityOutput, "NewPath")).toThrow("钥匙串里没有");
	});

	it("同名的两张证书有歧义，要求改用 SHA-1", () => {
		const other = "1".repeat(40);
		const output = `${findIdentityOutput}\n  3) ${other} "NewPath Signing"\n`;
		expect(() => findSigningIdentity(output, "NewPath Signing")).toThrow(other);
	});

	it("钥匙串里没有证书时给出创建方法", () => {
		expect(() => findSigningIdentity("     0 identities found\n", "NewPath Signing")).toThrow("证书助理");
	});
});

describe("hardened runtime", () => {
	it("ad-hoc 的 Electron.app 没有开启（node_modules 里的真实输出）", () => {
		const output =
			"Executable=/x/Electron.app/Contents/MacOS/Electron\n" +
			"CodeDirectory v=20400 size=392 flags=0x20002(adhoc,linker-signed) hashes=9+0 location=embedded\n";
		expect(hasHardenedRuntime(output)).toBe(false);
	});

	it("证书签名并带 runtime 时开启", () => {
		expect(hasHardenedRuntime("CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=28+7 location=embedded\n")).toBe(
			true,
		);
	});

	it("读不到 CodeDirectory 时视为没有开启", () => {
		expect(hasHardenedRuntime("")).toBe(false);
	});
});

describe("要单独签名的 Swift 小工具", () => {
	const entry = (name, kind) => ({ name, isFile: () => kind === "file", isDirectory: () => kind === "dir" });

	it("签 newpath-* 可执行文件和 .app 包，跳过其他文件和目录", () => {
		const entries = [
			entry("newpath-window-list", "file"),
			entry("newpath-ocr", "file"),
			entry("newpath-capture-agent.app", "dir"),
			entry("newpath-cache", "dir"),
			entry(".DS_Store", "file"),
		];
		expect(nativeHelperTargets(entries)).toEqual(["newpath-capture-agent.app", "newpath-ocr", "newpath-window-list"]);
	});
});
