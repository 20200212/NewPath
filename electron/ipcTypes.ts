/** 主进程与渲染进程共享的 IPC 数据结构。只放类型，不放运行时代码。 */

/** 渲染进程坐标（CSS 像素，相对于截图所在显示器左上角）。 */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type CaptureAction = "copy" | "save" | "edit";

/** 选区窗口拿到的冻结画面。 */
export interface CaptureSessionInfo {
	/** 每次截图递增，用来丢弃过期的会话。 */
	id: number;
	/** 仅用于显示的 JPEG；最终裁剪使用主进程里的原始位图，不损失画质。 */
	imageBytes: Uint8Array;
	mimeType: string;
	scaleFactor: number;
}

export interface CaptureFinishPayload {
	rect: Rect;
	action: CaptureAction;
}

export type SaveResult = { saved: true; filePath: string } | { saved: false };
