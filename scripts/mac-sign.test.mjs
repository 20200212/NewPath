import { describe, expect, it } from "vitest";
import { identityFromFindIdentity } from "./mac-sign.mjs";

const HASH = "04DA0BE632515E04CE46FE9BE3F36A8EE76597C6";

describe("identityFromFindIdentity", () => {
	it("取出自签名证书的 SHA-1，同一张证书出现两次只算一个", () => {
		const output = [
			"Policy: Code Signing",
			"  Matching identities",
			`  1) ${HASH} "NewPath Signing" (CSSMERR_TP_NOT_TRUSTED)`,
			"     1 identities found",
			"",
			"  Valid identities only",
			`  1) ${HASH} "NewPath Signing"`,
			"     1 valid identities found",
		].join("\n");
		expect(identityFromFindIdentity(output)).toBe(HASH);
	});

	it("没有或有多张证书时报错，不猜", () => {
		expect(() => identityFromFindIdentity("     0 identities found")).toThrow();
		const two = `  1) ${HASH} "A"\n  2) ${"B".repeat(40)} "B"`;
		expect(() => identityFromFindIdentity(two)).toThrow();
	});
});
