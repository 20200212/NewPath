import type { OnboardingState, OnboardingStep, ScreenPermission, ScrollCaptureState, ScrollStatus } from "../../electron/ipcTypes";
import type { ElectronAPI } from "../../electron/preload";

/** 欢迎引导窗口用到的那部分接口。 */
export type OnboardingApi = Pick<
	ElectronAPI,
	| "getOnboardingState"
	| "onOnboardingChanged"
	| "requestScreenPermission"
	| "relaunchForPermission"
	| "finishOnboarding"
	| "setOpenAtLogin"
	| "closeWindow"
>;

/** 拖拽授权小窗用到的接口。 */
export type PermissionHelperApi = Pick<ElectronAPI, "startPermissionDrag">;

/** 滚动截图面板用到的接口。 */
export type ScrollCaptureApi = Pick<
	ElectronAPI,
	"getScrollState" | "onScrollChanged" | "getScrollPreview" | "finishScroll" | "cancelScroll"
>;

const log = (...args: unknown[]) => console.info("[dev:ui]", ...args);
const params = () => new URLSearchParams(window.location.search);

function createEmitter() {
	const listeners = new Set<() => void>();
	return {
		emit: () => listeners.forEach((listener) => listener()),
		subscribe: (callback: () => void) => {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
	};
}

const STEPS: readonly OnboardingStep[] = ["welcome", "permission", "done"];
const PERMISSIONS: readonly ScreenPermission[] = ["not-determined", "granted", "denied", "restricted", "unknown"];

let onboardingState: OnboardingState | null = null;
const onboardingEvents = createEmitter();

/**
 * dev:ui 下的引导状态，可以用查询参数调整：
 * ?step=permission、?permission=denied、?dev=Terminal（开发模式提示的宿主）或 ?dev=fixture、?shortcut=Alt+C、?login=unsupported。
 */
function mockOnboardingState(): OnboardingState {
	if (onboardingState) return onboardingState;
	const query = params();
	const step = query.get("step") as OnboardingStep;
	const permission = query.get("permission") as ScreenPermission;
	const dev = query.get("dev");
	onboardingState = {
		step: STEPS.includes(step) ? step : "welcome",
		permission: PERMISSIONS.includes(permission) ? permission : "not-determined",
		captureShortcut: query.get("shortcut") ?? "Alt+C",
		shortcutRegistered: query.get("shortcutInUse") === null,
		openAtLogin: false,
		openAtLoginSupported: query.get("login") !== "unsupported",
		dev: dev === null ? null : dev === "fixture" ? { host: null, fixture: true } : { host: dev, fixture: false },
	};
	return onboardingState;
}

function updateOnboarding(patch: Partial<OnboardingState>) {
	onboardingState = { ...mockOnboardingState(), ...patch };
	onboardingEvents.emit();
}

export const mockOnboardingApi: OnboardingApi = {
	getOnboardingState: async () => ({ ...mockOnboardingState() }),
	onOnboardingChanged: onboardingEvents.subscribe,
	requestScreenPermission: async () => {
		log("requestScreenPermission");
		// 模拟用户在系统设置里打开开关
		window.setTimeout(() => updateOnboarding({ permission: "granted" }), 1500);
		return mockOnboardingState().permission;
	},
	relaunchForPermission: async () => {
		log("relaunchForPermission");
		updateOnboarding({ step: "done" });
	},
	finishOnboarding: async (capture) => log("finishOnboarding", capture),
	setOpenAtLogin: async (enabled) => {
		updateOnboarding({ openAtLogin: enabled });
		return { ok: true };
	},
	closeWindow: async () => log("closeWindow"),
};

export const mockPermissionHelperApi: PermissionHelperApi = {
	startPermissionDrag: () => log("startPermissionDrag"),
};

const SCROLL_STATUSES: readonly ScrollStatus[] = ["waiting", "capturing", "behind", "lost", "full", "finishing", "error"];
const MOCK_FRAME = { width: 1280, height: 800 };
const MAX_MOCK_HEIGHT = MOCK_FRAME.height * 12;

let scrollState: ScrollCaptureState | null = null;
let scrollTimer = 0;
const scrollEvents = createEmitter();

/** dev:ui 下模拟滚动拼接：长图每隔一段时间变长；?status=lost 之类可以固定显示某个状态。 */
function mockScrollState(): ScrollCaptureState {
	if (scrollState) return scrollState;
	const fixed = params().get("status") as ScrollStatus;
	const pinned = SCROLL_STATUSES.includes(fixed);
	scrollState = {
		status: pinned ? fixed : "waiting",
		width: MOCK_FRAME.width,
		height: pinned && fixed !== "waiting" ? MOCK_FRAME.height * 3 : MOCK_FRAME.height,
		frameHeight: MOCK_FRAME.height,
		previewId: 1,
	};
	if (!pinned) {
		scrollTimer = window.setInterval(() => {
			const current = mockScrollState();
			const height = Math.min(MAX_MOCK_HEIGHT, current.height + Math.round(120 + Math.random() * 240));
			scrollState = {
				...current,
				status: height >= MAX_MOCK_HEIGHT ? "full" : "capturing",
				height,
				previewId: current.previewId + 1,
			};
			if (height >= MAX_MOCK_HEIGHT) window.clearInterval(scrollTimer);
			scrollEvents.emit();
		}, 700);
	}
	return scrollState;
}

/** 画一张和当前长度成比例的条纹图当作拼接预览。 */
async function mockScrollPreview(state: ScrollCaptureState): Promise<Uint8Array | null> {
	const width = 320;
	const height = Math.round((state.height / state.width) * width);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d")!;
	const band = Math.round((state.frameHeight / state.width) * width);
	for (let y = 0, index = 0; y < height; y += band, index++) {
		ctx.fillStyle = index % 2 === 0 ? "#1e3a8a" : "#9d174d";
		ctx.fillRect(0, y, width, band);
		ctx.fillStyle = "rgba(255,255,255,0.85)";
		ctx.font = "bold 28px sans-serif";
		ctx.fillText(String(index + 1), 16, y + 40);
	}
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
	return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export const mockScrollCaptureApi: ScrollCaptureApi = {
	getScrollState: async () => ({ ...mockScrollState() }),
	onScrollChanged: scrollEvents.subscribe,
	getScrollPreview: () => mockScrollPreview(mockScrollState()),
	finishScroll: async () => {
		log("finishScroll");
		window.clearInterval(scrollTimer);
		scrollState = { ...mockScrollState(), status: "finishing" };
		scrollEvents.emit();
	},
	cancelScroll: async () => {
		log("cancelScroll");
		window.clearInterval(scrollTimer);
	},
};
