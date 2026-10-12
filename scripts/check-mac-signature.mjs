import { checkReleaseSignatures, releaseRequirementFromEnv } from "./mac-signing-policy.mjs";

// CI 打包后检查 Mac 包的签名身份：
//   node scripts/check-mac-signature.mjs [--expect-certificate] release/*/mac*/NewPath.app
// --expect-certificate：CI 配置了证书，包必须是证书签名（退回 ad-hoc 时失败）。
// 环境变量 NEWPATH_RELEASE_REQUIREMENT：发布版应满足的签名身份；没设置时只检查“固定签名、各架构一致”。
// 没配证书、也没设置上面两项时，ad-hoc 包跳过检查，不让流水线失败。
const args = process.argv.slice(2);
const expectCertificate = args.includes("--expect-certificate");
const apps = args.filter((arg) => arg !== "--expect-certificate");
if (!apps.length || apps.some((app) => app.startsWith("--"))) {
	console.error("用法：node scripts/check-mac-signature.mjs [--expect-certificate] <NewPath.app>...");
	process.exit(2);
}

const result = await checkReleaseSignatures(apps, { requirement: releaseRequirementFromEnv(), expectCertificate });
for (const { app, requirement } of result.apps) console.log(`${app}: ${requirement}`);
if (result.skipped) console.log(`::notice title=macOS 签名::${result.reason}`);
else console.log(result.requirement ? `全部满足 ${result.requirement}` : "全部是固定签名身份，且各架构一致");
