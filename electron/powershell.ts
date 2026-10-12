import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 系统自带的 Windows PowerShell 5.1；用 -EncodedCommand 传脚本，不落盘、也不受执行策略限制。 */
export const POWERSHELL = "powershell.exe";

/** PowerShell 的 -EncodedCommand 要求 UTF-16LE 再 Base64。 */
export function encodePowerShell(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

export function powerShellArgs(script: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)];
}

/**
 * 长脚本超过命令行长度上限（约 32K 字符，-EncodedCommand 还会膨胀近三倍）时，先写成文件再用 -File 运行。
 * 文件名带内容哈希：脚本改了就换新文件，旧文件留着也无妨。内容要带 UTF-8 BOM，否则 PowerShell 5.1 按系统代码页读，中文会乱码。
 */
export function writePowerShellScript(name: string, script: string): string {
	const hash = createHash("sha1").update(script).digest("hex").slice(0, 12);
	const filePath = path.join(os.tmpdir(), `${name}-${hash}.ps1`);
	if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `\ufeff${script}`, "utf8");
	return filePath;
}

export function powerShellFileArgs(scriptPath: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
}

/** PowerShell 单引号字符串字面量：单引号写两次即可转义。 */
export function quotePowerShell(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** 运行一次性脚本，返回 stdout（脚本里需要把输出编码设为 UTF-8）。 */
export function runPowerShell(script: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			POWERSHELL,
			powerShellArgs(script),
			{ windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (error) reject(new Error(stderr.trim() || error.message));
				else resolve(stdout);
			},
		);
	});
}
