import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

// electron-builder 的 mac.sign 钩子。按下面的顺序选签名身份：
//   1. electron-builder 自己找到的受信任证书（Developer ID Application），之后它还会按 APPLE_ID 等环境变量自动公证；
//   2. 环境变量 NEWPATH_MAC_IDENTITY 指定的证书（名称或 SHA-1），可以是钥匙串里的自签名证书；
//   3. CSC_LINK 导入的证书，即使是 macOS 不信任的自签名证书也照用；
//   4. 都没有时临时签名（ad-hoc）。
// 为什么需要它：electron-builder 会跳过不受信任的证书，找不到证书时干脆不签名，而 Apple 芯片上未签名的包打不开。
// 屏幕录制权限记在签名身份上：ad-hoc 签名每次构建身份都会变，用户每次更新都要重新授权；
// 用同一张证书（哪怕是自签名）签名，身份跨版本不变，授权就能保留。详见 Docs/macOS.md。

const exec = promisify(execFile);
const { sign } = createRequire(import.meta.url)("app-builder-lib/out/codeSign/macCodeSign");

/** 从 `security find-identity` 的输出里取出唯一一张代码签名证书的 SHA-1。 */
export function identityFromFindIdentity(output) {
	const hashes = new Set([...output.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s/gm)].map((match) => match[1]));
	if (hashes.size !== 1) throw new Error(`导入的证书里应当正好有一个代码签名身份，实际找到 ${hashes.size} 个`);
	return [...hashes][0];
}

export default async function signNewPath(options) {
	let identity = options.identity || process.env.NEWPATH_MAC_IDENTITY;
	if (!identity && options.keychain) {
		// 不加 -v：自签名证书在 macOS 看来“无效”，加了就列不出来
		const { stdout } = await exec("security", ["find-identity", "-p", "codesigning", options.keychain]);
		identity = identityFromFindIdentity(stdout);
	}
	console.log(`  • NewPath 签名身份：${identity || "ad-hoc（临时签名）"}`);
	await sign({ ...options, identity: identity || "-" });
}
