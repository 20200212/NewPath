import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { powerShellArgs, POWERSHELL } from "./powershell";
import { parseRawWindows, type RawWindow } from "./windowRects";

/**
 * 枚举顶层窗口的 C# 代码，由常驻的 PowerShell 进程编译一次后反复调用。
 * 矩形取 DWM 的扩展边框（不含看不见的缩放边框），始终是物理像素。
 */
const WINDOW_LIST_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NewPathWindows {
	private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

	[StructLayout(LayoutKind.Sequential)]
	private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr hWnd, int index);
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr hWnd, StringBuilder name, int maxCount);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
	[DllImport("user32.dll")] private static extern int GetWindowTextLengthW(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out NativeRect value, int size);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

	private const int GWL_EXSTYLE = -20;
	private const int WS_EX_TOOLWINDOW = 0x80;
	private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
	private const int DWMWA_CLOAKED = 14;
	private const int MAX_WINDOWS = 200;
	private const int MIN_SIZE = 40;

	public static void UsePhysicalPixels() {
		try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
	}

	public static string List(uint excludeProcessId) {
		StringBuilder json = new StringBuilder("[");
		int count = 0;
		EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
			if (count >= MAX_WINDOWS) return false;
			if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
			if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
			int cloaked;
			if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
			uint processId;
			GetWindowThreadProcessId(hWnd, out processId);
			if (processId == excludeProcessId) return true;
			StringBuilder className = new StringBuilder(256);
			GetClassNameW(hWnd, className, className.Capacity);
			string cls = className.ToString();
			if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
			NativeRect rect;
			if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(NativeRect))) != 0) return true;
			int width = rect.Right - rect.Left;
			int height = rect.Bottom - rect.Top;
			if (width < MIN_SIZE || height < MIN_SIZE) return true;
			int length = GetWindowTextLengthW(hWnd);
			StringBuilder title = new StringBuilder(length + 1);
			if (length > 0) GetWindowTextW(hWnd, title, title.Capacity);

			if (count > 0) json.Append(',');
			json.Append("{\"x\":").Append(rect.Left)
				.Append(",\"y\":").Append(rect.Top)
				.Append(",\"width\":").Append(width)
				.Append(",\"height\":").Append(height)
				.Append(",\"title\":\"").Append(Escape(title.ToString())).Append("\"}");
			count++;
			return true;
		}, IntPtr.Zero);
		return json.Append(']').ToString();
	}

	private static string Escape(string value) {
		StringBuilder result = new StringBuilder(value.Length);
		foreach (char c in value) {
			if (c == '"' || c == '\\') result.Append('\\').Append(c);
			else if (c < ' ') result.Append("\\u").Append(((int)c).ToString("x4"));
			else result.Append(c);
		}
		return result.ToString();
	}
}
`;

/** 常驻脚本：每读到一行 "list <请求号> <要排除的进程号>"，输出一行 "<请求号> <JSON>"。 */
const WINDOW_LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
${WINDOW_LIST_SOURCE}
'@
[NewPathWindows]::UsePhysicalPixels()
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
	$line = [Console]::In.ReadLine()
	if ($null -eq $line) { break }
	$parts = $line.Split(' ')
	if ($parts.Length -lt 3 -or $parts[0] -ne 'list') { continue }
	$json = '[]'
	try { $json = [NewPathWindows]::List([uint32]$parts[2]) } catch { }
	[Console]::Out.WriteLine($parts[1] + ' ' + $json)
	[Console]::Out.Flush()
}
`;

const REQUEST_TIMEOUT_MS = 1500;
/** 进程刚启动、C# 还在编译时多等一会儿；窗口列表本来就比画面晚到，不影响首帧。 */
const STARTUP_TIMEOUT_MS = 6000;

/**
 * Windows 上枚举可见窗口。PowerShell 启动和编译 C# 要一两秒，
 * 所以进程常驻、应用启动时就拉起来；进程意外退出后下次请求时自动重启。
 */
export class WindowListHelper {
	private child: ChildProcessWithoutNullStreams | null = null;
	private buffer = "";
	private ready = false;
	private seq = 0;
	private pending = new Map<number, (windows: RawWindow[]) => void>();

	start() {
		if (this.child || process.platform !== "win32") return;
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(POWERSHELL, powerShellArgs(WINDOW_LIST_SCRIPT), { windowsHide: true });
		} catch (error) {
			console.warn("无法启动窗口枚举进程", error);
			return;
		}
		this.child = child;
		this.buffer = "";
		this.ready = false;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.onData(chunk));
		child.stderr.setEncoding("utf8");
		// PowerShell 在 stdin 被重定向时会往 stderr 写 CLIXML 格式的进度信息，忽略掉
		child.stderr.on("data", (chunk: string) => {
			const text = chunk.trim();
			if (text && !text.startsWith("#< CLIXML") && !text.startsWith("<Objs")) console.warn("[window-list]", text);
		});
		child.on("error", (error) => console.warn("窗口枚举进程出错", error));
		child.on("exit", () => {
			if (this.child === child) this.child = null;
			this.flushPending();
		});
	}

	/** 按 Z 序从前往后返回可见窗口；失败或超时返回空数组。 */
	list(excludeProcessId: number): Promise<RawWindow[]> {
		if (process.platform !== "win32") return Promise.resolve([]);
		this.start();
		const child = this.child;
		if (!child) return Promise.resolve([]);
		const id = ++this.seq;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve([]);
			}, this.ready ? REQUEST_TIMEOUT_MS : STARTUP_TIMEOUT_MS);
			this.pending.set(id, (windows) => {
				clearTimeout(timer);
				resolve(windows);
			});
			child.stdin.write(`list ${id} ${excludeProcessId}\n`);
		});
	}

	dispose() {
		const child = this.child;
		this.child = null;
		this.flushPending();
		if (child) {
			child.stdin.end();
			child.kill();
		}
	}

	private onData(chunk: string) {
		this.buffer += chunk;
		let newline: number;
		while ((newline = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line === "ready") {
				this.ready = true;
				continue;
			}
			const space = line.indexOf(" ");
			if (space < 0) continue;
			const id = Number(line.slice(0, space));
			const resolve = this.pending.get(id);
			if (!resolve) continue;
			this.pending.delete(id);
			resolve(parseRawWindows(line.slice(space + 1)));
		}
	}

	private flushPending() {
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const resolve of pending) resolve([]);
	}
}
