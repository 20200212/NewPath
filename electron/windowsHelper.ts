import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Rect } from "./ipcTypes";
import { HelperStreamParser, type HelperMessage } from "./helperStream";
import { powerShellFileArgs, POWERSHELL, writePowerShellScript } from "./powershell";
import { parseRawWindows, type RawWindow } from "./windowRects";

/**
 * Windows 上的常驻助手进程：一个 PowerShell 进程在启动时编译一次下面的 C#，之后按行收命令：
 *
 *   list <请求号> <要排除的进程号>            → <请求号> <窗口 JSON 数组>
 *   window <请求号> <HWND> <PNG 路径>          → <请求号> {"width","height"}   单独截取一个窗口（PrintWindow）
 *   scroll-start <请求号> <x> <y> <w> <h>       → <请求号> ok                   开始连续截取屏幕上的这块区域（物理像素）
 *   scroll-stop <请求号>                        → <请求号> ok
 *
 * 出错时回 "<请求号> error <原因>"。滚动截取的每一帧以 "frame <序号> <宽> <高> <字节数>\n" 加原始 BGRA 字节
 * 主动写到 stdout，由 HelperStreamParser 切开。所有输出都经过 C# 里同一把锁，文本和帧不会交错。
 * 矩形取 DWM 的扩展边框（不含看不见的缩放边框），始终是物理像素。
 */
const HELPER_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NewPathWindows {
	private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

	[StructLayout(LayoutKind.Sequential)]
	private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

	[StructLayout(LayoutKind.Sequential)]
	private struct BitmapInfoHeader {
		public int Size; public int Width; public int Height; public short Planes; public short BitCount;
		public int Compression; public int SizeImage; public int XPelsPerMeter; public int YPelsPerMeter;
		public int ClrUsed; public int ClrImportant;
	}

	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
	[DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);
	[DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr hWnd, int index);
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr hWnd, StringBuilder name, int maxCount);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
	[DllImport("user32.dll")] private static extern int GetWindowTextLengthW(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
	[DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
	[DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
	[DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
	[DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
	[DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
	[DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfoHeader info, uint usage, out IntPtr bits, IntPtr section, uint offset);
	[DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint rop);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out NativeRect value, int size);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
	[DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int memcmp(byte[] a, byte[] b, UIntPtr count);

	private const int GWL_EXSTYLE = -20;
	private const int WS_EX_TOOLWINDOW = 0x80;
	private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
	private const int DWMWA_CLOAKED = 14;
	private const int MAX_WINDOWS = 200;
	private const int MIN_SIZE = 40;
	private const uint PW_RENDERFULLCONTENT = 2;
	private const uint SRCCOPY = 0x00CC0020;
	private const uint CAPTUREBLT = 0x40000000;
	// 帧的节拍：最快 30fps；大选区按字节数放慢，总吞吐大约不超过 120MB/s
	private const int MIN_INTERVAL_MS = 33;
	private const long MAX_BYTES_PER_SECOND = 120L * 1024 * 1024;

	private static readonly object OutLock = new object();
	private static readonly Stream Stdout = Console.OpenStandardOutput();
	private static Thread scrollThread;
	private static volatile bool scrollStop;
	private static int scrollSeq;

	public static void UsePhysicalPixels() {
		try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
	}

	/// 文本回复：一行 UTF-8。
	public static void Reply(string line) {
		byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
		lock (OutLock) {
			Stdout.Write(bytes, 0, bytes.Length);
			Stdout.Flush();
		}
	}

	private static void WriteFrame(int seq, int width, int height, byte[] data) {
		byte[] header = Encoding.ASCII.GetBytes("frame " + seq + " " + width + " " + height + " " + data.Length + "\n");
		lock (OutLock) {
			Stdout.Write(header, 0, header.Length);
			Stdout.Write(data, 0, data.Length);
			Stdout.Flush();
		}
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
			json.Append("{\"id\":").Append(hWnd.ToInt64())
				.Append(",\"x\":").Append(rect.Left)
				.Append(",\"y\":").Append(rect.Top)
				.Append(",\"width\":").Append(width)
				.Append(",\"height\":").Append(height)
				.Append(",\"title\":\"").Append(Escape(title.ToString())).Append("\"}");
			count++;
			return true;
		}, IntPtr.Zero);
		return json.Append(']').ToString();
	}

	/// 单独截取一个窗口：PrintWindow 让窗口自己把内容画出来，被其他窗口挡住的部分也完整。
	/// 结果裁到 DWM 的扩展边框（去掉看不见的缩放边框），写成 PNG。
	public static string CaptureWindow(long handle, string path) {
		IntPtr hWnd = new IntPtr(handle);
		if (!IsWindow(hWnd) || !IsWindowVisible(hWnd) || IsIconic(hWnd)) throw new Exception("no-window");
		NativeRect windowRect;
		if (!GetWindowRect(hWnd, out windowRect)) throw new Exception("no-rect");
		NativeRect frame;
		if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out frame, Marshal.SizeOf(typeof(NativeRect))) != 0) frame = windowRect;
		int width = windowRect.Right - windowRect.Left;
		int height = windowRect.Bottom - windowRect.Top;
		if (width <= 0 || height <= 0) throw new Exception("empty");
		using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
			bool printed;
			using (Graphics graphics = Graphics.FromImage(bitmap)) {
				IntPtr hdc = graphics.GetHdc();
				try {
					// 返回值几乎总是 true（画不出来的窗口得到纯色图），真正的失败由主进程按像素判断
					printed = PrintWindow(hWnd, hdc, PW_RENDERFULLCONTENT);
				} finally {
					graphics.ReleaseHdc(hdc);
				}
			}
			if (!printed) throw new Exception("print-failed");
			Rectangle crop = Rectangle.Intersect(
				new Rectangle(frame.Left - windowRect.Left, frame.Top - windowRect.Top, frame.Right - frame.Left, frame.Bottom - frame.Top),
				new Rectangle(0, 0, width, height));
			if (crop.Width <= 0 || crop.Height <= 0) throw new Exception("empty");
			using (Bitmap cropped = bitmap.Clone(crop, PixelFormat.Format32bppArgb)) {
				FixAlpha(cropped);
				cropped.Save(path, ImageFormat.Png);
				return "{\"width\":" + crop.Width + ",\"height\":" + crop.Height + "}";
			}
		}
	}

	/// GDI 画出来的像素 alpha 通常全是 0；如果整张都是 0 就当作不透明，否则保留窗口自己的透明度。
	private static void FixAlpha(Bitmap bitmap) {
		BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
		try {
			int count = Math.Abs(data.Stride) * bitmap.Height;
			byte[] bytes = new byte[count];
			Marshal.Copy(data.Scan0, bytes, 0, count);
			bool anyAlpha = false;
			for (int i = 3; i < count; i += 4) {
				if (bytes[i] != 0) { anyAlpha = true; break; }
			}
			if (anyAlpha) return;
			for (int i = 3; i < count; i += 4) bytes[i] = 255;
			Marshal.Copy(bytes, 0, data.Scan0, count);
		} finally {
			bitmap.UnlockBits(data);
		}
	}

	/// 开始连续截取屏幕区域（物理像素、全局坐标），每一帧有变化时写到 stdout。
	public static void StartScroll(int x, int y, int width, int height) {
		StopScroll();
		if (width <= 0 || height <= 0) throw new Exception("empty");
		scrollStop = false;
		Thread thread = new Thread(delegate () { ScrollLoop(x, y, width, height); });
		thread.IsBackground = true;
		thread.Priority = ThreadPriority.AboveNormal;
		thread.Start();
		scrollThread = thread;
	}

	public static void StopScroll() {
		Thread thread = scrollThread;
		scrollThread = null;
		if (thread == null) return;
		scrollStop = true;
		thread.Join(3000);
	}

	private static void ScrollLoop(int x, int y, int width, int height) {
		IntPtr screen = GetDC(IntPtr.Zero);
		IntPtr memory = CreateCompatibleDC(screen);
		BitmapInfoHeader info = new BitmapInfoHeader();
		info.Size = Marshal.SizeOf(typeof(BitmapInfoHeader));
		info.Width = width;
		// 负高度：第一行在最上面
		info.Height = -height;
		info.Planes = 1;
		info.BitCount = 32;
		IntPtr bits;
		IntPtr dib = CreateDIBSection(screen, ref info, 0, out bits, IntPtr.Zero, 0);
		IntPtr previous = SelectObject(memory, dib);
		int count = width * height * 4;
		byte[] current = new byte[count];
		byte[] last = new byte[count];
		bool haveLast = false;
		long interval = Math.Max(MIN_INTERVAL_MS, count * 1000L / MAX_BYTES_PER_SECOND);
		Stopwatch clock = Stopwatch.StartNew();
		try {
			while (!scrollStop) {
				long started = clock.ElapsedMilliseconds;
				if (dib != IntPtr.Zero && BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY | CAPTUREBLT)) {
					Marshal.Copy(bits, current, 0, count);
					for (int i = 3; i < count; i += 4) current[i] = 255;
					if (!haveLast || memcmp(current, last, new UIntPtr((uint)count)) != 0) {
						WriteFrame(++scrollSeq, width, height, current);
						byte[] swap = last;
						last = current;
						current = swap;
						haveLast = true;
					}
				}
				long wait = interval - (clock.ElapsedMilliseconds - started);
				if (wait > 0) Thread.Sleep((int)wait);
			}
		} finally {
			SelectObject(memory, previous);
			if (dib != IntPtr.Zero) DeleteObject(dib);
			DeleteDC(memory);
			ReleaseDC(IntPtr.Zero, screen);
		}
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

/** 常驻脚本：每读到一行命令就调用对应的 C# 方法，所有输出都经 Reply 写出。 */
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies @('System.Drawing') -TypeDefinition @'
${HELPER_SOURCE}
'@
[NewPathWindows]::UsePhysicalPixels()
[NewPathWindows]::Reply('ready')
while ($true) {
	$line = [Console]::In.ReadLine()
	if ($null -eq $line) { break }
	$parts = $line.Split(' ', 4)
	if ($parts.Length -lt 2) { continue }
	$command = $parts[0]
	$req = $parts[1]
	try {
		switch ($command) {
			'list' { [NewPathWindows]::Reply($req + ' ' + [NewPathWindows]::List([uint32]$parts[2])) }
			'window' { [NewPathWindows]::Reply($req + ' ' + [NewPathWindows]::CaptureWindow([int64]$parts[2], $parts[3])) }
			'scroll-start' {
				$rect = $parts[3].Split(' ')
				[NewPathWindows]::StartScroll([int]$parts[2], [int]$rect[0], [int]$rect[1], [int]$rect[2])
				[NewPathWindows]::Reply($req + ' ok')
			}
			'scroll-stop' { [NewPathWindows]::StopScroll(); [NewPathWindows]::Reply($req + ' ok') }
			default { [NewPathWindows]::Reply($req + ' error unknown-command') }
		}
	} catch {
		$reason = $_.Exception.GetBaseException().Message -replace '[^A-Za-z0-9_.-]', '_'
		[NewPathWindows]::Reply($req + ' error ' + $reason)
	}
}
[NewPathWindows]::StopScroll()
`;

const REQUEST_TIMEOUT_MS = 1500;
const WINDOW_TIMEOUT_MS = 2500;
const SCROLL_TIMEOUT_MS = 3000;
/** 进程刚启动、C# 还在编译时多等一会儿；窗口列表本来就比画面晚到，不影响首帧。 */
const STARTUP_TIMEOUT_MS = 6000;

export interface HelperFrame {
	seq: number;
	width: number;
	height: number;
	/** BGRA，每行 width * 4 字节；独立的 ArrayBuffer，可以直接 transfer。 */
	data: ArrayBuffer;
}

interface Pending {
	resolve: (payload: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Windows 上枚举可见窗口、单独截取窗口、为滚动截图连续截屏。PowerShell 启动和编译 C# 要一两秒，
 * 所以进程常驻、应用启动时就拉起来；进程意外退出后下次请求时自动重启，请求超时也会重启（卡住的进程会拖慢之后每一次请求）。
 */
export class WindowsHelper {
	private child: ChildProcessWithoutNullStreams | null = null;
	private readonly parser = new HelperStreamParser();
	private ready = false;
	private seq = 0;
	private readonly pending = new Map<number, Pending>();
	private frameListener: ((frame: HelperFrame) => void) | null = null;
	private exitListener: (() => void) | null = null;

	get available() {
		return process.platform === "win32";
	}

	start() {
		if (this.child || !this.available) return;
		let child: ChildProcessWithoutNullStreams;
		try {
			// 脚本连 C# 一起超过了命令行长度上限，只能走文件
			child = spawn(POWERSHELL, powerShellFileArgs(writePowerShellScript("newpath-windows-helper", HELPER_SCRIPT)), {
				windowsHide: true,
			});
		} catch (error) {
			console.warn("无法启动 Windows 助手进程", error);
			return;
		}
		this.child = child;
		this.parser.reset();
		this.ready = false;
		child.stdout.on("data", (chunk: Buffer) => {
			if (this.child === child) this.onMessages(this.parser.push(chunk));
		});
		child.stderr.setEncoding("utf8");
		// PowerShell 在 stdin 被重定向时会往 stderr 写 CLIXML 格式的进度信息，忽略掉
		child.stderr.on("data", (chunk: string) => {
			const text = chunk.trim();
			if (text && !text.startsWith("#< CLIXML") && !text.startsWith("<Objs")) console.warn("[windows-helper]", text);
		});
		child.on("error", (error) => console.warn("Windows 助手进程出错", error));
		child.on("exit", () => {
			if (this.child !== child) return;
			this.child = null;
			this.ready = false;
			this.failPending();
			this.exitListener?.();
		});
	}

	/** 杀掉当前进程，下次请求时重新拉起。 */
	restart() {
		const child = this.child;
		this.child = null;
		this.ready = false;
		this.failPending();
		if (child) {
			child.stdin.end();
			child.kill();
		}
		this.exitListener?.();
	}

	dispose() {
		const child = this.child;
		this.child = null;
		this.failPending();
		if (child) {
			child.stdin.end();
			child.kill();
		}
	}

	/** 进程退出或被重启时通知；滚动截图进行中收到它就意味着帧不会再来了。 */
	onExit(listener: (() => void) | null) {
		this.exitListener = listener;
	}

	/** 按 Z 序从前往后返回可见窗口；失败或超时返回空数组。 */
	async list(excludeProcessId: number): Promise<RawWindow[]> {
		const payload = await this.request(`list`, [String(excludeProcessId)], REQUEST_TIMEOUT_MS);
		return payload ? parseRawWindows(payload) : [];
	}

	/** 把窗口单独截成 PNG；成功返回尺寸，窗口已关闭、PrintWindow 失败、超时都返回 null。 */
	async captureWindow(hwnd: number, pngPath: string): Promise<{ width: number; height: number } | null> {
		if (!Number.isSafeInteger(hwnd) || hwnd <= 0) return null;
		const payload = await this.request("window", [String(hwnd), pngPath], WINDOW_TIMEOUT_MS);
		if (!payload || payload.startsWith("error ")) return null;
		try {
			const { width, height } = JSON.parse(payload) as { width?: unknown; height?: unknown };
			return typeof width === "number" && typeof height === "number" && width > 0 && height > 0 ? { width, height } : null;
		} catch {
			return null;
		}
	}

	/** 开始连续截取 rect（全局物理像素）；之后每一帧经 onFrame 送出，直到 stopScroll 或进程退出。 */
	async startScroll(rect: Rect, onFrame: (frame: HelperFrame) => void): Promise<boolean> {
		this.frameListener = onFrame;
		const args = [rect.x, rect.y, rect.width, rect.height].map((value) => String(Math.round(value)));
		const payload = await this.request("scroll-start", args, SCROLL_TIMEOUT_MS);
		if (payload !== "ok") {
			this.frameListener = null;
			return false;
		}
		return true;
	}

	async stopScroll(): Promise<void> {
		this.frameListener = null;
		if (!this.child) return;
		await this.request("scroll-stop", [], SCROLL_TIMEOUT_MS);
	}

	/** 发一行命令，返回回复里请求号之后的部分；超时、进程不在时返回 null。 */
	private request(command: string, args: string[], timeoutMs: number): Promise<string | null> {
		if (!this.available) return Promise.resolve(null);
		this.start();
		const child = this.child;
		if (!child) return Promise.resolve(null);
		const id = ++this.seq;
		const wasReady = this.ready;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				resolve(null);
				// 启动期间超时多半是还在编译，不动它；之后的超时说明进程卡住了
				if (wasReady && this.child === child) this.restart();
			}, wasReady ? timeoutMs : STARTUP_TIMEOUT_MS + timeoutMs);
			this.pending.set(id, {
				resolve: (payload) => {
					clearTimeout(timer);
					resolve(payload);
				},
				timer,
			});
			child.stdin.write(`${[command, id, ...args].join(" ")}\n`);
		});
	}

	private onMessages(messages: HelperMessage[]) {
		for (const message of messages) {
			if (message.kind === "frame") {
				this.frameListener?.(message);
				continue;
			}
			const line = message.text;
			if (line === "ready") {
				this.ready = true;
				continue;
			}
			const space = line.indexOf(" ");
			if (space < 0) continue;
			const id = Number(line.slice(0, space));
			const entry = this.pending.get(id);
			if (!entry) continue;
			this.pending.delete(id);
			entry.resolve(line.slice(space + 1));
		}
	}

	private failPending() {
		const entries = [...this.pending.values()];
		this.pending.clear();
		for (const entry of entries) {
			clearTimeout(entry.timer);
			entry.resolve(null);
		}
		this.frameListener = null;
	}
}
