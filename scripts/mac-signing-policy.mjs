import { execFile } from "node:child_process";
import { promisify } from "node:util";

// macOS 把屏幕录制权限记在应用的 designated requirement（下称“签名身份”）上。
// 这里集中放签名身份的读取和判断：本机签名（sign-mac-local.mjs）、本机安装（install-mac-local.mjs）
// 和 CI 验签（check-mac-signature.mjs）都用它。执行命令的部分都接受可注入的 run，方便测试。

const exec = promisify(execFile);

/** 从 `codesign -d -r-` 的输出里取出 designated requirement；新版 codesign 写在 stderr，前面带 `# `。 */
export function parseDesignatedRequirement(output) {
	return output.match(/^(?:#\s*)?designated => (.+)$/m)?.[1]?.trim() ?? null;
}

export async function readDesignatedRequirement(app, run = exec) {
	const { stdout = "", stderr = "" } = await run("codesign", ["-d", "-r-", app]);
	return parseDesignatedRequirement(`${stdout}\n${stderr}`);
}

/**
 * 绑定证书的签名身份跨构建不变；ad-hoc 签名的身份是 `cdhash H"…"`，每次构建都变。
 * 自签名证书由 electron-builder 签名时，codesign 默认生成 `certificate root = H"…"`（单张自签名证书时根就是叶子），
 * sign-mac-local.mjs 显式写成 `certificate leaf = H"…"`；Developer ID 签名是 `anchor apple generic …`。
 */
export function isStableRequirement(requirement) {
	if (!requirement) return false;
	return /\bcertificate (?:leaf|root)\s*=\s*H"[0-9a-f]{40}"/i.test(requirement) || /\banchor apple\b/.test(requirement);
}

/**
 * sign-mac-local.mjs 写进应用的签名身份：只认这个 Bundle ID 加这张证书。
 * 哈希用小写，和 `codesign -d -r-` 读回来的写法一致，签完可以直接比较。
 */
export function localSigningRequirement(bundleId, certificateSha1) {
	if (!/^[0-9A-F]{40}$/i.test(certificateSha1)) throw new Error(`证书 SHA-1 格式不对：${certificateSha1}`);
	return `identifier "${bundleId}" and certificate leaf = H"${certificateSha1.toLowerCase()}"`;
}

/**
 * 发布版应当使用的签名身份，来自环境变量 NEWPATH_RELEASE_REQUIREMENT（CI 里放在仓库 Variables）。
 * 证书还没定下来时不设置，验签只做能做的检查。
 */
export function releaseRequirementFromEnv(env = process.env) {
	const value = env.NEWPATH_RELEASE_REQUIREMENT?.trim();
	return value || null;
}

/**
 * CI 验签：检查各架构的 NewPath.app。
 * - 配置了 requirement：每个包都必须满足它，且自身是固定签名身份；
 * - 没配置：每个包都必须是固定签名身份，且各架构身份完全一致（不一致时用户换架构安装会被要求重新授权）；
 * - 全是 ad-hoc、没配置 requirement、也没声明 expectCertificate（CI 没配证书）时跳过，返回 skipped。
 */
export async function checkReleaseSignatures(apps, { requirement = null, expectCertificate = false, run = exec } = {}) {
	if (!apps.length) throw new Error("没有要检查的应用");
	const results = [];
	for (const app of apps) {
		await run("codesign", ["--verify", "--deep", "--strict", app]);
		const designated = await readDesignatedRequirement(app, run);
		if (!designated) throw new Error(`${app}：读不到签名身份`);
		results.push({ app, requirement: designated, stable: isStableRequirement(designated) });
	}

	if (results.every((result) => !result.stable) && !requirement && !expectCertificate) {
		return {
			skipped: true,
			reason: "全部是 ad-hoc 签名，且没有配置证书和 NEWPATH_RELEASE_REQUIREMENT：跳过签名身份检查。这样的包每次更新都要重新授权屏幕录制。",
			apps: results,
		};
	}

	const unstable = results.filter((result) => !result.stable);
	if (unstable.length) {
		throw new Error(
			`以下应用没有使用固定签名身份（可能退回了 ad-hoc 签名）：\n${unstable.map((result) => `  ${result.app}: ${result.requirement}`).join("\n")}`,
		);
	}

	if (requirement) {
		for (const result of results) {
			try {
				await run("codesign", ["--verify", "--deep", "--strict", `-R=${requirement}`, result.app]);
			} catch (cause) {
				throw new Error(`${result.app} 不满足发布签名身份 ${requirement}（实际为 ${result.requirement}）`, { cause });
			}
		}
	} else {
		const distinct = new Set(results.map((result) => result.requirement));
		if (distinct.size > 1) {
			throw new Error(
				`各架构的签名身份不一致：\n${results.map((result) => `  ${result.app}: ${result.requirement}`).join("\n")}`,
			);
		}
	}
	return { skipped: false, requirement, apps: results };
}

// 停止或替换已安装的应用之前先确认签名身份连续：新包必须满足旧包的 designated requirement。
// 名称、路径、版本相同都不代表身份不变，ad-hoc 包也照样检查。
export async function verifyMacUpdateIdentity(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const requirement = await readDesignatedRequirement(target, run);
	if (!requirement) {
		throw new Error("无法读取已安装 NewPath 的签名身份；应用保持原样。");
	}
	try {
		await run("codesign", ["--verify", "--deep", "--strict", `-R=${requirement}`, source]);
	} catch (cause) {
		throw new Error(
			"停止替换：新包与已安装 NewPath 的签名身份不兼容，继续安装会要求重新授权屏幕录制。" +
				"已安装的是 ad-hoc 包、新包用证书签名时用 --migrate-signing；明确接受重新授权时用 --accept-reauthorization。应用及现有权限保持原样。",
			{ cause },
		);
	}
	return requirement;
}

/**
 * 用户明确要求的一次性迁移：已安装的是 ad-hoc 包（身份绑定某次构建的 cdhash），新包换成固定签名身份。
 * 迁移后要重新授权一次屏幕录制，之后的更新都能通过 verifyMacUpdateIdentity。
 */
export async function verifyMacSigningMigration(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const installed = await readDesignatedRequirement(target, run);
	if (!installed) {
		throw new Error("无法读取已安装 NewPath 的签名身份；应用保持原样。");
	}
	if (isStableRequirement(installed)) {
		throw new Error("已安装的 NewPath 已使用固定签名，请用常规安装，不需要迁移。");
	}
	const next = await readDesignatedRequirement(source, run);
	if (!next || !isStableRequirement(next)) {
		throw new Error("新包没有使用固定签名身份，迁移已停止；应用保持原样。");
	}
	await run("codesign", ["--verify", "--deep", "--strict", `-R=${next}`, source]);
	return { from: installed, to: next };
}

/** 只在用户明确接受重新授权屏幕录制时使用。两个应用的签名仍须有效、可读。 */
export async function verifyMacReauthorizedChange(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const installed = await readDesignatedRequirement(target, run);
	const next = await readDesignatedRequirement(source, run);
	if (!installed || !next) {
		throw new Error("无法读取签名身份；应用保持原样。");
	}
	await run("codesign", ["--verify", "--deep", "--strict", `-R=${next}`, source]);
	return { from: installed, to: next, acceptedReauthorization: true };
}
