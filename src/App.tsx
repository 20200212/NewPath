import type { ReactNode } from "react";
import { Editor } from "./components/editor/Editor";
import { MainWindow } from "./components/main/MainWindow";
import { Onboarding } from "./components/onboarding/Onboarding";
import { PermissionHelper } from "./components/onboarding/PermissionHelper";
import { PinnedImage } from "./components/pin/PinnedImage";
import { RegionSelector } from "./components/screenshot/RegionSelector";
import { ScrollCapturePanel } from "./components/screenshot/ScrollCapturePanel";

/** 所有窗口共用一个页面，主进程通过 ?windowType= 决定渲染哪个界面。 */
const windowType = new URLSearchParams(window.location.search).get("windowType") ?? "";

/** 透明窗口：页面背景必须透明，圆角面板之外露出桌面。 */
const TRANSPARENT_WINDOWS = new Set(["permission-helper", "scroll-capture"]);
if (TRANSPARENT_WINDOWS.has(windowType)) document.documentElement.classList.add("transparent-window");

/** dev:ui 下按主进程给的窗口尺寸预览小窗口，背景用棋盘格代表透明。 */
const DEV_WINDOW_SIZES: Record<string, { width: number; height: number }> = {
	onboarding: { width: 760, height: 540 },
	"permission-helper": { width: 400, height: 96 },
	"scroll-capture": { width: 260, height: 420 },
};

function DevWindowFrame({ children }: { children: ReactNode }) {
	const size = DEV_WINDOW_SIZES[windowType];
	if (window.electronAPI || !size) return <>{children}</>;
	const query = new URLSearchParams(window.location.search);
	const width = Number(query.get("width")) || size.width;
	const height = Number(query.get("height")) || size.height;
	return (
		<div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(#d4d4d8_0_25%,#f4f4f5_0_50%)] bg-[length:24px_24px]">
			<div className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-black/10" style={{ width, height }}>
				{children}
			</div>
		</div>
	);
}

function WindowContent() {
	switch (windowType) {
		case "screenshot-region":
			return <RegionSelector />;
		case "screenshot-preview":
			return <Editor />;
		case "screenshot-pin":
			return <PinnedImage />;
		case "onboarding":
			return <Onboarding />;
		case "permission-helper":
			return <PermissionHelper />;
		case "scroll-capture":
			return <ScrollCapturePanel />;
		default:
			// "main"，以及 dev:ui 下不带参数直接打开
			return <MainWindow />;
	}
}

export default function App() {
	return (
		<DevWindowFrame>
			<WindowContent />
		</DevWindowFrame>
	);
}
