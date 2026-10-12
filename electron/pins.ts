import { screen, type BrowserWindow, type IpcMainInvokeEvent, type NativeImage } from "electron";
import { mt } from "./i18n";
import type { PinImageInfo } from "./ipcTypes";
import { initialPinBounds, zoomPinBounds, type Point, type Size } from "./pinGeometry";

/** 渲染进程一直没有报告就绪（页面加载失败等）时，超过这个时间就销毁窗口。 */
const PIN_READY_TIMEOUT_MS = 8000;
/** 钉图缩小时宽度的下限（原图更窄时以原图为准）。 */
const PIN_MIN_WIDTH = 80;

interface PinRecord {
	win: BrowserWindow;
	/** 原始位图，复制和保存时使用。 */
	image: NativeImage;
	/** 宽 / 高。 */
	aspect: number;
	/** 打开时的宽度（DIP），用来算缩放比例。 */
	baseWidth: number;
	/** 自己记住窗口尺寸：跨越缩放比例不同的显示器时，getBounds() 返回的尺寸可能有误差。 */
	size: Size;
	dragOffset: Point | null;
	ready: boolean;
}

type CreatePinWindow = (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;

/** 管理所有钉图窗口：置顶、无边框、透明，由渲染进程报告就绪后再显示。 */
export class PinManager {
	private pins = new Map<number, PinRecord>();

	constructor(
		private readonly createWindow: CreatePinWindow,
		private readonly onChange: () => void,
	) {}

	get count() {
		return this.pins.size;
	}

	/** 所有钉图窗口（滚动截图让出前台后要把它们重新显示出来）。 */
	get windows(): BrowserWindow[] {
		return [...this.pins.values()].map((record) => record.win).filter((win) => !win.isDestroyed());
	}

	/**
	 * 打开一张钉图。image 是物理像素，按 scaleFactor 换算成窗口尺寸，
	 * 这样钉图和截图时屏幕上看到的一样大；origin 为 null 时放在工作区右上角。
	 */
	open(image: NativeImage, scaleFactor: number, origin: Point | null) {
		const pixels = image.getSize();
		if (pixels.width < 1 || pixels.height < 1) return;
		const size = {
			width: Math.max(1, Math.round(pixels.width / scaleFactor)),
			height: Math.max(1, Math.round(pixels.height / scaleFactor)),
		};
		const point = origin ?? screen.getCursorScreenPoint();
		const workArea = screen.getDisplayNearestPoint(point).workArea;
		const bounds = initialPinBounds(size, origin, workArea, this.pins.size);

		const win = this.createWindow({
			...bounds,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			hasShadow: false,
			title: mt().pinWindowTitle,
		});
		win.setAlwaysOnTop(true, "floating");
		// macOS 上切换桌面（Space）或进入全屏应用时，钉图也跟着显示
		if (process.platform === "darwin") {
			win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
		}

		const record: PinRecord = {
			win,
			image,
			aspect: size.width / size.height,
			baseWidth: bounds.width,
			size: { width: bounds.width, height: bounds.height },
			dragOffset: null,
			ready: false,
		};
		const id = win.webContents.id;
		this.pins.set(id, record);
		win.on("closed", () => {
			this.pins.delete(id);
			this.onChange();
		});
		setTimeout(() => {
			if (!record.ready && !win.isDestroyed()) win.destroy();
		}, PIN_READY_TIMEOUT_MS);
		this.onChange();
	}

	/** 只接受来自钉图窗口的调用。 */
	fromEvent(event: IpcMainInvokeEvent): PinRecord | null {
		const record = this.pins.get(event.sender.id);
		return record && !record.win.isDestroyed() ? record : null;
	}

	imageInfo(record: PinRecord): PinImageInfo {
		return { dataUrl: record.image.toDataURL() };
	}

	/** 图片画好后再显示，不抢焦点。 */
	markReady(record: PinRecord) {
		if (record.ready) return;
		record.ready = true;
		const { x, y } = record.win.getBounds();
		record.win.showInactive();
		// 与选区窗口相同：缩放比例不同的多显示器下，显示后再校正一次位置和尺寸
		record.win.setBounds({ x, y, ...record.size });
	}

	dragStart(record: PinRecord) {
		const cursor = screen.getCursorScreenPoint();
		const [x, y] = record.win.getPosition();
		record.dragOffset = { x: cursor.x - x, y: cursor.y - y };
	}

	dragMove(record: PinRecord) {
		if (!record.dragOffset) return;
		const cursor = screen.getCursorScreenPoint();
		record.win.setBounds({
			x: cursor.x - record.dragOffset.x,
			y: cursor.y - record.dragOffset.y,
			...record.size,
		});
	}

	dragEnd(record: PinRecord) {
		record.dragOffset = null;
	}

	/** 以光标为中心缩放，返回相对打开时的缩放比例（百分比）。 */
	zoom(record: PinRecord, factor: number): number {
		const cursor = screen.getCursorScreenPoint();
		const [x, y] = record.win.getPosition();
		const workArea = screen.getDisplayNearestPoint(cursor).workArea;
		const next = zoomPinBounds({ x, y, ...record.size }, factor, cursor, record.aspect, {
			minWidth: Math.min(PIN_MIN_WIDTH, record.baseWidth),
			maxWidth: workArea.width,
			maxHeight: workArea.height,
		});
		record.size = { width: next.width, height: next.height };
		record.win.setBounds(next);
		return Math.round((next.width / record.baseWidth) * 100);
	}

	closeAll() {
		for (const record of [...this.pins.values()]) {
			if (!record.win.isDestroyed()) record.win.close();
		}
	}
}
