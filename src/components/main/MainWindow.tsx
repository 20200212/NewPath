import { ArrowDown, ArrowUp, Camera, FolderOpen, FolderTree, Images, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LanguageSetting, ScreenshotItem, SelectionMode, SettingsState } from "../../../electron/ipcTypes";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/ui/Toast";
import { WindowControls } from "@/components/ui/WindowControls";
import { useI18n } from "@/i18n";
import { formatAccelerator } from "@/lib/accelerator";
import { isMac } from "@/lib/platform";
import { mockMainApi } from "@/lib/mockLibrary";
import { DEFAULT_SORT, sortScreenshots, toggleSort, type SortKey, type SortState } from "@/lib/sortScreenshots";
import { ROW_GRID, ScreenshotRow, type RowAction } from "./ScreenshotRow";
import { SettingsModal } from "./SettingsModal";

/** 主界面：截图库。列出保存目录里的截图，并提供截图入口和设置。 */
export function MainWindow() {
	const api = window.electronAPI ?? mockMainApi;
	const { t } = useI18n();
	const [items, setItems] = useState<ScreenshotItem[] | null>(null);
	const [settings, setSettings] = useState<SettingsState | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
	const sortedItems = useMemo(() => (items ? sortScreenshots(items, sort) : null), [items, sort]);
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
		showToast(t.main.toast.saveDirChanged);
		void refresh();
	};

	const changeShortcut = async (accelerator: string) => {
		const result = await api.setCaptureShortcut(accelerator);
		if (result.ok) {
			setSettings(await api.getSettings());
			showToast(t.main.toast.shortcutChanged(formatAccelerator(accelerator, isMac)));
		}
		return result;
	};

	const changeLanguage = async (language: LanguageSetting) => {
		setSettings(await api.setLanguage(language));
	};

	const changeSelectionMode = async (mode: SelectionMode) => {
		setSettings(await api.setSelectionMode(mode));
	};

	/** 每次打开设置都重新拉取：屏幕录制权限可能在系统设置里改过。 */
	const openSettings = () => {
		setSettingsOpen(true);
		void api.getSettings().then(setSettings);
	};

	const changeOpenAtLogin = async (enabled: boolean) => {
		const result = await api.setOpenAtLogin(enabled);
		if (!result.ok) {
			showToast(result.reason, "error");
			return;
		}
		setSettings(await api.getSettings());
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
		if (action === "copy") showToast(t.main.toast.imageCopied);
		else if (action === "copyPath") showToast(t.main.toast.pathCopied);
		else if (action === "delete") {
			showToast(t.main.toast.movedToTrash(item.name));
			void refresh();
		}
	};

	const onRename = async (item: ScreenshotItem, newName: string) => {
		const result = await api.renameScreenshot(item.name, newName);
		if (!result.ok) {
			showToast(result.reason, "error");
			return false;
		}
		showToast(t.main.toast.renamed);
		void refresh();
		return true;
	};

	const shortcutLabel = settings ? formatAccelerator(settings.captureShortcut, isMac) : "";

	return (
		<div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-apple-canvas font-sans selection:bg-apple-blue/20">
			{/* 顶部工具栏兼标题栏：空白处可以拖动窗口；macOS 上左侧留给系统的红绿灯按钮 */}
			<header
				className={`drag z-10 flex shrink-0 items-center gap-4 border-b border-gray-200/50 bg-white/60 py-5 backdrop-blur-xl ${isMac ? "pl-[92px] pr-6" : "px-6"}`}
			>
				<Button
					title={shortcutLabel ? t.main.toolbar.startCaptureWithShortcut(shortcutLabel) : t.main.toolbar.startCapture}
					onClick={() => void api.startCapture()}
				>
					<Camera size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:scale-110" />
					{t.main.toolbar.startCapture}
				</Button>
				<Button variant="secondary" onClick={() => void chooseSaveDir()}>
					<FolderOpen size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:scale-110" />
					{t.main.toolbar.chooseFolder}
				</Button>

				<button
					type="button"
					title={isMac ? t.main.toolbar.openSaveDirMac : t.main.toolbar.openSaveDir}
					className="no-drag group relative min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-gray-100/80 py-3.5 pl-12 pr-4 text-left transition-all duration-300 hover:border-apple-blue/30 hover:bg-white"
					onClick={() => void api.openSaveDir()}
				>
					<FolderTree
						size={18}
						className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-hover:text-apple-blue"
					/>
					<span className="block truncate text-sm font-bold text-gray-600">{settings?.saveDir ?? " "}</span>
				</button>

				<Button variant="icon" title={t.main.toolbar.preferences} onClick={openSettings}>
					<Settings
						size={22}
						strokeWidth={2.5}
						className="transition-transform duration-500 ease-out group-hover:rotate-90"
					/>
				</Button>

				{!isMac && (
					<>
						<div className="h-8 w-px shrink-0 bg-gray-200" />
						<WindowControls onMinimize={() => void api.minimizeWindow()} onClose={() => void api.closeWindow()} />
					</>
				)}
			</header>

			<main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
				{/* 表头放在滚动区里吸顶，这样和行的列宽始终对齐（包括出现滚动条时）；左右内边距 = 行的边框 + 内边距 */}
				<div
					className={`${ROW_GRID} sticky top-0 z-10 shrink-0 bg-apple-canvas/90 px-[1.125rem] py-5 text-xs font-black uppercase tracking-widest text-gray-400 backdrop-blur-md`}
				>
					<div>
						{t.main.list.name}
						{items && items.length > 0 && <span className="ml-2 text-gray-300">{items.length}</span>}
					</div>
					<SortHeader label={t.main.list.modified} sortKey="mtime" sort={sort} onSort={setSort} />
					<SortHeader label={t.main.list.size} sortKey="size" sort={sort} onSort={setSort} />
					<div className="pr-10 text-right">{t.main.list.actions}</div>
				</div>

				{items?.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center text-gray-400">
						<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 shadow-inner">
							<Images size={40} strokeWidth={2} className="text-gray-300" />
						</div>
						<p className="text-sm font-bold text-gray-500">{t.main.list.emptyTitle}</p>
						<p className="mt-2 text-xs font-medium">
							{shortcutLabel ? t.main.list.emptyHintWithShortcut(shortcutLabel) : t.main.list.emptyHint}
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{sortedItems?.map((item) => (
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
					mac={isMac}
					onClose={() => setSettingsOpen(false)}
					onChangeShortcut={changeShortcut}
					onChangeLanguage={(language) => void changeLanguage(language)}
					onChangeOpenAtLogin={(enabled) => void changeOpenAtLogin(enabled)}
					onChangeSelectionMode={(mode) => void changeSelectionMode(mode)}
					onOpenOnboarding={() => void api.openOnboarding()}
					onOpenLogs={() => void api.openLogs()}
					onRecordingChange={(recording) => void api.suspendShortcut(recording)}
				/>
			)}
			<Toast toast={toast} />
		</div>
	);
}

const SORT_ORDER_LABEL = {
	mtime: { desc: "newest", asc: "oldest" },
	size: { desc: "largest", asc: "smallest" },
} as const;

/** 可点击排序的列头：再次点击切换升降序，当前排序列显示箭头。 */
function SortHeader({
	label,
	sortKey,
	sort,
	onSort,
}: {
	label: string;
	sortKey: SortKey;
	sort: SortState;
	onSort: (next: SortState) => void;
}) {
	const { t } = useI18n();
	const active = sort.key === sortKey;
	const next = toggleSort(sort, sortKey);
	const Arrow = sort.dir === "desc" ? ArrowDown : ArrowUp;

	return (
		<button
			type="button"
			title={t.main.list.sortClickTo(t.main.list.sortOrder[SORT_ORDER_LABEL[next.key][next.dir]])}
			className={`no-drag group flex items-center gap-1 justify-self-start font-black uppercase tracking-widest transition-colors hover:text-apple-blue ${active ? "text-gray-600" : ""}`}
			onClick={() => onSort(next)}
		>
			{label}
			{active ? (
				<Arrow size={13} strokeWidth={3} />
			) : (
				<ArrowDown size={13} strokeWidth={3} className="opacity-0 transition-opacity group-hover:opacity-50" />
			)}
		</button>
	);
}
