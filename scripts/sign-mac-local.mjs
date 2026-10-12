import { execFile } from "node:child_process";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BUNDLE_ID, builtAppPath } from "./mac-app.mjs";
import { localSigningRequirement, readDesignatedRequirement } from "./mac-signing-policy.mjs";

// 用登录钥匙串里的自签名证书给本机打出的 NewPath.app 重新签名，签名身份跨构建不变，屏幕录制授权就能保留。
//   node scripts/sign-mac-local.mjs [NewPath.app]
// 证书默认叫 “NewPath Signing”（见 Docs/macOS.md），可用环境变量 NEWPATH_MAC_IDENTITY 换成别的名称或 SHA-1。
// 不传路径时签 release/<版本>/mac-arm64/NewPath.app（Intel 上是 mac/NewPath.app）。

const exec = promisify(execFile);
export const DEFAULT_IDENTITY = "NewPath Signing";

/**
 * 从 `security find-identity -p codesigning` 的输出里找出要用的证书。
 * 不能加 -v：自签名证书在 macOS 看来“不受信任”，加了就列不出来。
 * `wanted` 是 40 位 SHA-1 时按哈希匹配，否则按名称完全匹配；同名的多张证书视为有歧义。
 */
export function findSigningIdentity(output, wanted) {
	const found = new Map();
	for (const match of output.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"/gim)) {
		found.set(match[1].toUpperCase(), match[2]);
	}
	const byHash = /^[0-9A-F]{40}$/i.test(wanted);
	const matches = [...found].filter(([hash, name]) => (byHash ? hash === wanted.toUpperCase() : name === wanted));
	if (!matches.length) {
		throw new Error(
			`钥匙串里没有代码签名证书 “${wanted}”。在“钥匙串访问 → 证书助理 → 创建证书”里创建一张` +
				`（名称 ${DEFAULT_IDENTITY}，身份类型“自签名根证书”，证书类型“代码签名”），或用 NEWPATH_MAC_IDENTITY 指定已有证书。`,
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`有 ${matches.length} 张证书都叫 “${wanted}”：${matches.map(([hash]) => hash).join("、")}。请把 NEWPATH_MAC_IDENTITY 设为其中一张的 SHA-1。`,
		);
	}
	const [[hash, name]] = matches;
	return { hash, name };
}

/** `codesign -dv` 的输出里 CodeDirectory 的 flags 是否带 runtime（hardened runtime）。 */
export function hasHardenedRuntime(output) {
	const flags = output.match(/^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m)?.[1];
	return flags ? flags.split(",").includes("runtime") : false;
}

/** Resources/native/ 下要单独签名的 Swift 小工具：可执行文件和 .app 包。 */
export function nativeHelperTargets(entries) {
	return entries
		.filter((entry) => entry.name.startsWith("newpath-") && (entry.isFile() || (entry.isDirectory() && entry.name.endsWith(".app"))))
		.map((entry) => entry.name)
		.sort();
}

async function main() {
	if (process.platform !== "darwin") throw new Error("本机签名只能在 macOS 上运行");
	const root = path.resolve(import.meta.dirname, "..");
	const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
	const app = path.resolve(process.argv[2] || builtAppPath(root, version));
	const infoPlist = path.join(app, "Contents", "Info.plist");
	await access(infoPlist).catch(() => {
		throw new Error(`找不到 ${app}，先运行 npm run pack:mac:dir`);
	});

	const { stdout: bundleId } = await exec("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", "--", infoPlist]);
	if (bundleId.trim() !== BUNDLE_ID) throw new Error(`${app} 的 Bundle ID 是 ${bundleId.trim()}，不是 ${BUNDLE_ID}`);

	const wanted = process.env.NEWPATH_MAC_IDENTITY || DEFAULT_IDENTITY;
	const { stdout: identities } = await exec("security", ["find-identity", "-p", "codesigning"]);
	const identity = findSigningIdentity(identities, wanted);

	// 标记为本机构建：以后若加自动更新，应跳过检查，免得公开版覆盖本机的修改和签名身份
	await writeFile(path.join(app, "Contents", "Resources", "local-build"), "Built and signed on this Mac.\n");

	// 对单张自签名证书，codesign 默认生成 `certificate root = …` 形式的签名身份；这里显式钉住叶子证书
	const requirement = localSigningRequirement(BUNDLE_ID, identity.hash);
	// 按 SHA-1 指定证书，避免同名证书歧义；保留 electron-builder 写入的 entitlements，hardened runtime 保持开启
	const sign = (target, extra = []) =>
		exec("codesign", [
			"--force",
			"--timestamp=none",
			"--options",
			"runtime",
			"--preserve-metadata=entitlements",
			...extra,
			"--sign",
			identity.hash,
			target,
		]);

	// 不在标准嵌套位置的代码会被当成资源封进主包，所以先签 Resources/native/ 下的小工具。
	// 主包不加 --deep：否则显式的签名身份会被盖到每个小工具上。
	const nativeDir = path.join(app, "Contents", "Resources", "native");
	const helpers = await readdir(nativeDir, { withFileTypes: true }).then(nativeHelperTargets, () => []);
	for (const helper of helpers) await sign(path.join(nativeDir, helper));
	await sign(app, ["--requirements", `=designated => ${requirement}`]);

	await exec("codesign", ["--verify", "--deep", "--strict", `-R=${requirement}`, app]);
	const designated = await readDesignatedRequirement(app);
	if (designated !== requirement) throw new Error(`签名后的签名身份不对：${designated}`);
	const { stdout = "", stderr = "" } = await exec("codesign", ["-dv", app]);
	if (!hasHardenedRuntime(`${stdout}\n${stderr}`)) throw new Error("签名后 hardened runtime 没有开启");

	console.log(JSON.stringify({ app, identity, requirement, helpers }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
