def edit(path, pairs):
	s = open(path, encoding="utf-8", newline="").read()
	for old, new in pairs:
		if old not in s:
			raise SystemExit(f"NOT FOUND in {path}: {old[:90]!r}")
		s = s.replace(old, new)
	open(path, "w", encoding="utf-8", newline="").write(s)

# ---------- 助手：activate 命令 ----------
edit("electron/windowsHelper.ts", [
	(''' *   scroll-stop <请求号>                        → <请求号> ok
 *''', ''' *   scroll-stop <请求号>                        → <请求号> ok
 *   activate <请求号> <HWND> <x> <y>           → <请求号> ok <方式>        把前台交给这个窗口（HWND 为 0 时取 x,y 处的窗口）
 *'''),
	('''	[StructLayout(LayoutKind.Sequential)]
	private struct BitmapInfoHeader {''', '''	[StructLayout(LayoutKind.Sequential)]
	private struct NativePoint { public int X; public int Y; }

	[StructLayout(LayoutKind.Sequential)]
	private struct BitmapInfoHeader {'''),
	('''	[DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);''',
	'''	[DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
	[DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(NativePoint point);
	[DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
	[DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool flag);
	[DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();'''),
	('''	private const uint PW_RENDERFULLCONTENT = 2;''', '''	private const uint PW_RENDERFULLCONTENT = 2;
	private const uint GA_ROOT = 2;'''),
	('''	/// 开始连续截取屏幕区域（物理像素、全局坐标），每一帧有变化时写到 stdout。''',
	'''	/// 把前台交给目标窗口，滚动截图期间用户的滚轮和键盘才会落到被截的页面上。
	/// handle 为 0 或已失效时取屏幕上 (x, y) 处的窗口（跳过鼠标穿透的窗口，所以不会选中我们自己的边框）。
	/// 本进程由前台进程（NewPath）启动，通常可以直接 SetForegroundWindow；不行时把输入队列挂到前台线程上再试。
	public static string Activate(long handle, int x, int y, uint excludeProcessId) {
		IntPtr target = new IntPtr(handle);
		if (target == IntPtr.Zero || !IsWindow(target) || !IsWindowVisible(target) || IsIconic(target)) {
			NativePoint point = new NativePoint();
			point.X = x;
			point.Y = y;
			IntPtr hit = WindowFromPoint(point);
			if (hit != IntPtr.Zero) hit = GetAncestor(hit, GA_ROOT);
			uint processId;
			GetWindowThreadProcessId(hit, out processId);
			if (hit == IntPtr.Zero || processId == excludeProcessId) throw new Exception("no-target");
			target = hit;
		}
		IntPtr foreground = GetForegroundWindow();
		if (foreground == target) return "ok already";
		if (SetForegroundWindow(target) && GetForegroundWindow() == target) return "ok direct";
		uint ignored;
		uint me = GetCurrentThreadId();
		uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
		uint targetThread = GetWindowThreadProcessId(target, out ignored);
		bool attachedForeground = foregroundThread != 0 && foregroundThread != me && AttachThreadInput(me, foregroundThread, true);
		bool attachedTarget = targetThread != 0 && targetThread != me && targetThread != foregroundThread && AttachThreadInput(me, targetThread, true);
		try {
			BringWindowToTop(target);
			SetForegroundWindow(target);
		} finally {
			if (attachedForeground) AttachThreadInput(me, foregroundThread, false);
			if (attachedTarget) AttachThreadInput(me, targetThread, false);
		}
		return GetForegroundWindow() == target ? "ok attached" : "failed";
	}

	/// 开始连续截取屏幕区域（物理像素、全局坐标），每一帧有变化时写到 stdout。'''),
	('''			'scroll-stop' { [NewPathWindows]::StopScroll(); [NewPathWindows]::Reply($req + ' ok') }''',
	'''			'scroll-stop' { [NewPathWindows]::StopScroll(); [NewPathWindows]::Reply($req + ' ok') }
			'activate' {
				$point = $parts[3].Split(' ')
				[NewPathWindows]::Reply($req + ' ' + [NewPathWindows]::Activate([int64]$parts[2], [int]$point[0], [int]$point[1], [uint32]$point[2]))
			}'''),
	('''	async stopScroll(): Promise<void> {''', '''	/**
	 * 把前台交给窗口 hwnd（为 null 时取屏幕上 point 处的窗口，物理像素）。返回助手用的方式（"already" / "direct" / "attached"），
	 * 失败返回 null。滚动截图开始、选区窗口隐藏之后调用，用户的滚轮和键盘才会落到被截的页面上。
	 */
	async activateWindow(hwnd: number | null, point: { x: number; y: number }, excludeProcessId: number): Promise<string | null> {
		const handle = hwnd !== null && Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : 0;
		const payload = await this.request(
			"activate",
			[String(handle), String(Math.round(point.x)), String(Math.round(point.y)), String(excludeProcessId)],
			REQUEST_TIMEOUT_MS,
		);
		if (!payload || !payload.startsWith("ok")) return null;
		return payload.slice(3) || "ok";
	}

	async stopScroll(): Promise<void> {'''),
])

# ---------- 控制器：Windows 上让出前台 = 隐藏主窗口 + 其他窗口排除采集 ----------
edit("electron/scrollSession.ts", [
	('''	/** Windows 10 2004 起：把边框和面板窗口从屏幕采集里排除（WDA_EXCLUDEFROMCAPTURE），它们就不会出现在长图里。 */
	excludeFromCapture: boolean;
}''', '''	/** Windows 10 2004 起：把边框和面板窗口从屏幕采集里排除（WDA_EXCLUDEFROMCAPTURE），它们就不会出现在长图里。 */
	excludeFromCapture: boolean;
	/** 让出前台时把 NewPath 的主窗口藏起来（结束后由调用方恢复）；macOS 上 app.hide() 已经包含了这一步。 */
	hideMainWindow?: () => void;
}'''),
	('''	/**
	 * 把前台还给正在滚动的应用，让它保持激活、接收键盘。隐藏应用会把所有窗口一起藏起来，
	 * 所以再把原本开着的钉图和编辑器不抢焦点地显示回来。
	 */
	private yieldForeground() {
		if (process.platform !== "darwin") return;
		const showing = this.deps.visibleWindows().filter((win) => !win.isDestroyed() && win.isVisible());
		app.hide();
		for (const win of showing) win.showInactive();
	}''', '''	/** Windows 上滚动期间临时排除采集的窗口（钉图、编辑器），结束时恢复。 */
	private protectedWindows: BrowserWindow[] = [];

	/**
	 * 把前台还给正在滚动的应用，让它保持激活、接收键盘。macOS 上隐藏应用会把所有窗口一起藏起来，
	 * 所以再把原本开着的钉图和编辑器不抢焦点地显示回来；截图进程本来就不截 NewPath 自己的窗口。
	 * Windows 上没有"隐藏应用"：主窗口藏起来（它挡着页面，也会被截进去），钉图和编辑器留在屏幕上，
	 * 但从屏幕采集里排除；焦点由调用方在选区窗口隐藏后用助手交给目标窗口。
	 */
	private yieldForeground() {
		if (process.platform === "darwin") {
			const showing = this.deps.visibleWindows().filter((win) => !win.isDestroyed() && win.isVisible());
			app.hide();
			for (const win of showing) win.showInactive();
			return;
		}
		this.deps.hideMainWindow?.();
		if (!this.deps.excludeFromCapture) return;
		for (const win of this.deps.visibleWindows()) {
			if (win.isDestroyed() || !win.isVisible()) continue;
			win.setContentProtection(true);
			this.protectedWindows.push(win);
		}
	}'''),
	('''		for (const win of [session.panel, session.ring]) if (win && !win.isDestroyed()) win.destroy();''',
	'''		for (const win of [session.panel, session.ring]) if (win && !win.isDestroyed()) win.destroy();
		for (const win of this.protectedWindows) if (!win.isDestroyed()) win.setContentProtection(false);
		this.protectedWindows = [];'''),
])

# ---------- main.ts：隐藏主窗口 + 焦点交接 ----------
edit("electron/main.ts", [
	('''			excludeFromCapture: supportsCaptureExclusion(process.platform, process.getSystemVersion()),
		})''', '''			excludeFromCapture: supportsCaptureExclusion(process.platform, process.getSystemVersion()),
			hideMainWindow: () => {
				const win = mainWindow;
				if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
					restoreMainAfterCapture = true;
					win.hide();
				}
			},
		})'''),
	('''	scrollContext = { mode: session.mode, stitchTarget: session.stitchTarget };
	closeCaptureSession({ keepHidden: true });
}''', '''	scrollContext = { mode: session.mode, stitchTarget: session.stitchTarget };
	closeCaptureSession({ keepHidden: true });
	if (process.platform === "win32") void handFocusToScrollTarget(session, rect);
}

/**
 * Windows：选区窗口隐藏后前台往往落在 NewPath 自己的某个隐藏窗口上，用户的键盘和滚轮就没地方去了。
 * 把前台交给选区中心处最前面的那个窗口（截图时识别出的窗口列表按 Z 序排列），没识别到就让助手按坐标找。
 */
async function handFocusToScrollTarget(session: CaptureSession, rect: Rect) {
	const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	const target =
		session.windows?.find(
			(item) =>
				item.id !== undefined &&
				center.x >= item.rect.x &&
				center.x < item.rect.x + item.rect.width &&
				center.y >= item.rect.y &&
				center.y < item.rect.y + item.rect.height,
		) ?? null;
	const { bounds } = session.display;
	const point = screen.dipToScreenPoint({ x: Math.round(bounds.x + center.x), y: Math.round(bounds.y + center.y) });
	const result = await windowsHelper.activateWindow(target?.id ?? null, point, process.pid);
	writeDiagnostic("scroll-focus-handoff", { known: target !== null, result });
}'''),
])
print("ok")
