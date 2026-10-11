import { execFile } from "node:child_process";

/** 系统自带的 Windows PowerShell 5.1；用 -EncodedCommand 传脚本，不落盘、也不受执行策略限制。 */
export const POWERSHELL = "powershell.exe";

/** PowerShell 的 -EncodedCommand 要求 UTF-16LE 再 Base64。 */
export function encodePowerShell(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

export function powerShellArgs(script: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)];
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
