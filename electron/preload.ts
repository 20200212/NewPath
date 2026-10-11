import { contextBridge, ipcRenderer } from "electron";
import type { CaptureFinishPayload, CaptureSessionInfo, SaveResult } from "./ipcTypes";

/** 渲染进程唯一能访问的主进程能力，新增 IPC 时必须在这里显式列出。 */
const api = {
	platform: process.platform,

	// 选区窗口（常驻复用：每次截图开始、结束时收到 capture:changed，再主动拉取会话）
	getCaptureSession: (): Promise<CaptureSessionInfo | null> =>
		ipcRenderer.invoke("capture:get-session"),
	onCaptureChanged: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("capture:changed", listener);
		return () => {
			ipcRenderer.removeListener("capture:changed", listener);
		};
	},
	/** 画面已经绘制完成，主进程可以让窗口可见了。 */
	captureReady: (sessionId: number): Promise<void> => ipcRenderer.invoke("capture:ready", sessionId),
	finishCapture: (payload: CaptureFinishPayload): Promise<void> =>
		ipcRenderer.invoke("capture:finish", payload),
	cancelCapture: (): Promise<void> => ipcRenderer.invoke("capture:cancel"),

	// 编辑窗口
	getPreviewImage: (): Promise<string | null> => ipcRenderer.invoke("preview:get-image"),
	copyImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke("image:copy", png),
	saveImage: (png: Uint8Array): Promise<SaveResult> => ipcRenderer.invoke("image:save", png),
	closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("electronAPI", api);
