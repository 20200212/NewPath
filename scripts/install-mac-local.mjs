import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { APP_NAME, BUNDLE_ID, INSTALL_TARGET, MAIN_EXECUTABLE, builtAppPath } from "./mac-app.mjs";
import { registerOnlyInstalledNewPath } from "./mac-app-registration.mjs";
import { verifyMacReauthorizedChange, verifyMacSigningMigration, verifyMacUpdateIdentity } from "./mac-signing-policy.mjs";

// 把本机打包、签好名的 NewPath.app 原位安装到 /Applications/NewPath.app 并重新启动。
//   node scripts/install-mac-local.mjs [NewPath.app] [--check] [--migrate-signing | --accept-reauthorization]
// 顺序：校验新包（Bundle ID、签名、版本、包内文件与本次构建一致）→ 校验签名身份与已安装的兼容
// → 复制到临时目录再校验一遍 → 停止旧进程 → 旧包移进备份目录 → 换上新包 → 只保留这一份注册 → 启动并写安装回执。
// 签名身份不兼容时在停止进程、改动安装目录之前退出。

const exec = promisify(execFile);
const USAGE =
	"用法：node scripts/install-mac-local.mjs [NewPath.app] [--check] [--migrate-signing | --accept-reauthorization]";
const FLAGS = new Set(["--check", "--migrate-signing", "--accept-reauthorization"]);

/**
 * --check：只检查，不停止进程、不安装、不重启；
 * --migrate-signing：已安装的是 ad-hoc 包，一次性换成固定签名身份（要重新授权一次）；
 * --accept-reauthorization：用户已确认接受重新授权屏幕录制，允许签名身份改变。
 */
export function parseInstallArgs(args) {
	const options = {
		checkOnly: args.includes("--check"),
		migrateSigning: args.includes("--migrate-signing"),
		acceptReauthorization: args.includes("--accept-reauthorization"),
		source: null,
	};
	const rest = args.filter((arg) => !FLAGS.has(arg));
	if (rest.length > 1 || rest.some((arg) => arg.startsWith("--")) || (options.migrateSigning && options.acceptReauthorization)) {
		throw new Error(USAGE);
	}
	options.source = rest[0] ?? null;
	return options;
}

/** 从 `ps -axo pid=,comm=` 的输出里挑出 NewPath 主进程（comm 是可执行文件的完整路径，不含参数）。 */
export function parseRunningApps(output) {
	const apps = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
		if (!match || !match[2].endsWith(MAIN_EXECUTABLE)) continue;
		apps.push({ pid: Number(match[1]), appPath: match[2].slice(0, -MAIN_EXECUTABLE.length) });
	}
	return apps;
}

/** 安装前要和本次构建逐字节比对的包内文件：页面、主进程、preload，以及渲染进程的入口脚本。 */
export function packagedFilesToCheck(asarEntries) {
	const entries = asarEntries.map((entry) => entry.replaceAll("\\", "/"));
	const renderer = entries.find((entry) => /^\/dist\/assets\/index-[^/]*\.js$/.test(entry));
	if (!renderer) throw new Error("包里没有渲染进程入口 dist/assets/index-*.js");
	return ["dist/index.html", "dist-electron/main.js", "dist-electron/preload.mjs", renderer.slice(1)];
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => access(file).then(() => true, () => false);
const launchServices = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

async function plist(appPath, key) {
	const { stdout } = await exec("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appPath, "Contents/Info.plist")]);
	return stdout.trim();
}

async function runningNewPaths() {
	const { stdout } = await exec("ps", ["-axo", "pid=,comm="]);
	const matches = [];
	for (const candidate of parseRunningApps(stdout)) {
		try {
			if ((await plist(candidate.appPath, "CFBundleIdentifier")) === BUNDLE_ID) matches.push(candidate);
		} catch {
			// 进程可能正好在检查时退出
		}
	}
	return matches;
}

async function main() {
	const options = parseInstallArgs(process.argv.slice(2));
	const root = path.resolve(import.meta.dirname, "..");
	const projectManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
	const source = path.resolve(options.source || builtAppPath(root, projectManifest.version));
	const target = INSTALL_TARGET;
	if (process.platform !== "darwin") throw new Error("本机安装只能在 macOS 上运行");
	if (source === target) throw new Error(USAGE);

	// —— 校验新包 ——
	if (!(await exists(path.join(source, "Contents/Info.plist")))) {
		throw new Error(`找不到新包 ${source}，先运行 npm run pack:mac:dir 和 npm run sign:mac:local`);
	}
	if ((await plist(source, "CFBundleIdentifier")) !== BUNDLE_ID) throw new Error(`${source} 的 Bundle ID 不是 ${BUNDLE_ID}`);
	await access(path.join(source, "Contents/Frameworks/Electron Framework.framework"));
	await exec("codesign", ["--verify", "--deep", "--strict", source]);

	const { default: asar } = await import("@electron/asar");
	const archive = path.join(source, "Contents/Resources/app.asar");
	const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
	if (manifest.version !== projectManifest.version || (await plist(source, "CFBundleShortVersionString")) !== manifest.version) {
		throw new Error("新包的版本号与项目不一致");
	}
	const hashes = {};
	for (const file of packagedFilesToCheck(asar.listPackage(archive))) {
		const bundled = asar.extractFile(archive, file);
		const built = await readFile(path.join(root, file));
		if (!bundled.equals(built)) throw new Error(`包已过期：${file} 与最近一次构建不一致，请重新打包`);
		hashes[file] = sha256(bundled);
	}
	const archiveHash = sha256(await readFile(archive));

	// —— 校验签名身份：不兼容时在这里退出，旧应用和权限都不动 ——
	let signingRequirement = null;
	let signingMigration = null;
	if (await exists(target)) {
		if ((await plist(target, "CFBundleIdentifier")) !== BUNDLE_ID) {
			throw new Error(`已有的 ${target} Bundle ID 不对，保持原样`);
		}
		if (options.migrateSigning) {
			signingMigration = await verifyMacSigningMigration(source, target);
			signingRequirement = signingMigration.to;
		} else if (options.acceptReauthorization) {
			signingMigration = await verifyMacReauthorizedChange(source, target);
			signingRequirement = signingMigration.to;
		} else {
			signingRequirement = await verifyMacUpdateIdentity(source, target);
		}
	}
	if (options.checkOnly) {
		console.log(JSON.stringify({ source, target, signingRequirement, signingMigration, archiveSha256: archiveHash, checkOnly: true }, null, 2));
		return;
	}

	// —— 先复制到 /Applications 下的临时目录并再校验，保证后面的 rename 是同一卷上的原子操作 ——
	const previousProcesses = await runningNewPaths();
	const appsDirectory = path.dirname(target);
	const stageDirectory = await mkdtemp(path.join(appsDirectory, ".newpath-stage-"));
	const stagedApp = path.join(stageDirectory, `${APP_NAME}.app`);
	await exec("ditto", [source, stagedApp]);
	await exec("codesign", ["--verify", "--deep", "--strict", stagedApp]);
	if (sha256(await readFile(path.join(stagedApp, "Contents/Resources/app.asar"))) !== archiveHash) {
		throw new Error("复制出的包与校验过的新包不一致");
	}

	// —— 停止旧进程 ——
	for (const { pid } of previousProcesses) {
		try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
	const stopDeadline = Date.now() + 10_000;
	while ((await runningNewPaths()).length > 0) {
		if (Date.now() >= stopDeadline) {
			// 临时副本也在 /Applications 下，留着可能被 LaunchServices 注册
			await rm(stageDirectory, { recursive: true, force: true });
			throw new Error("NewPath 没有退出，已安装的应用保持原样");
		}
		await delay(150);
	}

	// —— 替换；任何一步失败都把旧包放回去 ——
	const backupRoot = path.join(os.homedir(), "Library", "Application Support", APP_NAME, "app-backups.noindex");
	let backup = null;
	let installed = false;
	try {
		if (await exists(target)) {
			await mkdir(backupRoot, { recursive: true });
			backup = path.join(await mkdtemp(path.join(backupRoot, "previous-")), `${APP_NAME}.app`);
			await rename(target, backup);
		}
		await rename(stagedApp, target);
		installed = true;
		await exec("codesign", ["--verify", "--deep", "--strict", target]);
		for (const previousApp of new Set([...previousProcesses.map(({ appPath }) => appPath), backup])) {
			if (previousApp && previousApp !== target) await exec(launchServices, ["-u", previousApp]).catch(() => {});
		}
		const registration = await registerOnlyInstalledNewPath(target);

		await exec("open", ["-n", target]);
		let current;
		const launchDeadline = Date.now() + 15_000;
		do {
			await delay(250);
			current = await runningNewPaths();
			if (current.length === 1 && current[0].appPath === target) break;
		} while (Date.now() < launchDeadline);
		if (current.length !== 1 || current[0].appPath !== target) {
			throw new Error("新安装的 NewPath 没有成为唯一运行的实例");
		}

		const receipt = {
			installedAt: new Date().toISOString(),
			version: manifest.version,
			source,
			target,
			pid: current[0].pid,
			archiveSha256: archiveHash,
			hashes,
			signingRequirement,
			signingMigration,
			registration,
			backup,
			previousProcesses,
		};
		const receiptPath = path.join(root, "release", "last-local-install.json");
		await mkdir(path.dirname(receiptPath), { recursive: true });
		await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
		console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
	} catch (error) {
		if (installed) {
			for (const processInfo of await runningNewPaths()) {
				if (processInfo.appPath === target) {
					try {
						process.kill(processInfo.pid, "SIGTERM");
					} catch {
						// 已经退出
					}
				}
			}
			// 失败的包留在临时目录里供排查，但撤销它的注册
			const failed = path.join(stageDirectory, `${APP_NAME}-failed.app`);
			await rename(target, failed);
			await exec(launchServices, ["-u", failed]).catch(() => {});
		}
		if (backup) {
			await rename(backup, target);
			await exec("open", ["-n", target]);
		}
		throw error;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
