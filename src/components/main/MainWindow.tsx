import { Camera, FolderOpen, FolderTree, Images, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ScreenshotItem, SettingsState } from "../../../electron/ipcTypes";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/ui/Toast";
import { WindowControls } from "@/components/ui/WindowControls";
import { formatAccelerator } from "@/lib/accelerator";
import { mockMainApi } from "@/lib/mockLibrary";
import { ROW_GRID, ScreenshotRow, type RowAction } from "./ScreenshotRow";
import { SettingsModal } from "./SettingsModal";

/** 主界面：截图库。列出保存目录里的截图，并提供截图入口和设置。 */
export function MainWindow() {
	const api = window.electronAPI ?? mockMainApi;
	const mac = window.electronAPI?.platform === "darwin";
	const [items, setItems] = useState<ScreenshotItem[] | null>(null);
	const [settings, setSettings] = useState<SettingsState | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const { toast, showToast } = useToast();

	const refresh = useCallback(async () => setItems(await api.listScreenshots()), [api]);

	useEffect(() => {
		void refresh();
		void api.getSettings().then(setSettings);
		return api.onLibraryChanged(() => void refresh());
	}, [api, refresh]);

	const chooseSaveDir = async () => {
		const next = await api.chooseSaveDir();
		if (!next) return;
		setSettings(next);
		showToast("已更换保存位置");
		void refresh();
	};

	const changeShortcut = async (accelerator: string) => {
		const result = await api.setCaptureShortcut(accelerator);
		if (result.ok) {
			setSettings(await api.getSettings());
			showToast(`快捷键已改为 ${formatAccelerator(accelerator)}`);
		}
		return result;
	};

	const onAction = async (action: RowAction, item: ScreenshotItem) => {
		const run = {
			copy: () => api.copyScreenshot(item.name),
			copyPath: () => api.copyScreenshotPath(item.name),
			reveal: () => api.revealScreenshot(item.name),
			edit: () => api.editScreenshot(item.name),
			delete: () => api.deleteScreenshot(item.name),
		}[action];
		const result = await run();
		if (!result.ok) {
			showToast(result.reason, "error");
			void refresh();
			return;
		}
		if (action === "copy") showToast("图片已复制到剪贴板");
		else if (action === "copyPath") showToast("文件路径已复制");
		else if (action === "delete") {
			showToast(`已移到回收站：${item.name}`);
			void refresh();
		}
	};

	const onRename = async (item: ScreenshotItem, newName: string) => {
		const result = await api.renameScreenshot(item.name, newName);
		if (!result.ok) {
			showToast(result.reason, "error");
			return false;
		}
		showToast("已重命名");
		void refresh();
		return true;
	};

	const shortcutLabel = settings ? formatAccelerator(settings.captureShortcut) : "";

	return (
		<div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-apple-canvas font-sans selection:bg-apple-blue/20">
			{/* 顶部工具栏兼标题栏：空白处可以拖动窗口 */}
			<header className="drag z-10 flex shrink-0 items-center gap-4 border-b border-gray-200/50 bg-white/60 px-6 py-5 backdrop-blur-xl">
				<Button
					title={shortcutLabel ? `开始截图（${shortcutLabel}）` : "开始截图"}
					onClick={() => void api.startCapture()}
				>
					<Camera size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:scale-110" />
					开始截图
				</Button>
				<Button variant="secondary" onClick={() => void chooseSaveDir()}>
					<FolderOpen size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:scale-110" />
					选择文件夹
				</Button>

				<button
					type="button"
					title="在资源管理器中打开"
					className="no-drag group relative min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-gray-100/80 py-3.5 pl-12 pr-4 text-left transition-all duration-300 hover:border-apple-blue/30 hover:bg-white"
					onClick={() => void api.openSaveDir()}
				>
					<FolderTree
						size={18}
						className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-hover:text-apple-blue"
					/>
					<span className="block truncate text-sm font-bold text-gray-600">{settings?.saveDir ?? " "}</span>
				</button>

				<Button variant="icon" title="偏好设置" onClick={() => setSettingsOpen(true)}>
					<Settings
						size={22}
						strokeWidth={2.5}
						className="transition-transform duration-500 ease-out group-hover:rotate-90"
					/>
				</Button>

				<div className="h-8 w-px shrink-0 bg-gray-200" />
				<WindowControls onMinimize={() => void api.minimizeWindow()} onClose={() => void api.closeWindow()} />
			</header>

			<main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
				{/* 表头放在滚动区里吸顶，这样和行的列宽始终对齐（包括出现滚动条时）；左右内边距 = 行的边框 + 内边距 */}
				<div
					className={`${ROW_GRID} sticky top-0 z-10 shrink-0 bg-apple-canvas/90 px-[1.125rem] py-5 text-xs font-black uppercase tracking-widest text-gray-400 backdrop-blur-md`}
				>
					<div>
						截图{items && items.length > 0 && <span className="ml-2 text-gray-300">{items.length}</span>}
					</div>
					<div>修改日期</div>
					<div>大小</div>
					<div className="pr-10 text-right">操作</div>
				</div>

				{items?.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center text-gray-400">
						<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 shadow-inner">
							<Images size={40} strokeWidth={2} className="text-gray-300" />
						</div>
						<p className="text-sm font-bold text-gray-500">还没有截图</p>
						<p className="mt-2 text-xs font-medium">
							{shortcutLabel ? `按 ${shortcutLabel} 或点击「开始截图」` : "点击「开始截图」"}
							，保存的截图会出现在这里
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{items?.map((item) => (
							<ScreenshotRow
								key={item.name}
								item={item}
								loadThumbnail={api.getThumbnail}
								onAction={(action, target) => void onAction(action, target)}
								onRename={onRename}
							/>
						))}
					</div>
				)}
			</main>

			{settingsOpen && settings && (
				<SettingsModal
					settings={settings}
					mac={mac}
					onClose={() => setSettingsOpen(false)}
					onChangeShortcut={changeShortcut}
					onRecordingChange={(recording) => void api.suspendShortcut(recording)}
					onChooseSaveDir={() => void chooseSaveDir()}
					onOpenSaveDir={() => void api.openSaveDir()}
				/>
			)}
			<Toast toast={toast} />
		</div>
	);
}
