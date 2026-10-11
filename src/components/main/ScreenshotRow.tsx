import { FolderSearch, ImageOff } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ScreenshotItem } from "../../../electron/ipcTypes";
import { ActionChip } from "@/components/ui/Button";
import { formatBytes, formatDate } from "@/lib/format";

export type RowAction = "copy" | "copyPath" | "reveal" | "edit" | "delete";

interface ScreenshotRowProps {
	item: ScreenshotItem;
	loadThumbnail: (name: string) => Promise<string | null>;
	onAction: (action: RowAction, item: ScreenshotItem) => void;
	/** 返回 true 表示改名成功，可以退出编辑状态。 */
	onRename: (item: ScreenshotItem, newName: string) => Promise<boolean>;
}

/** 列宽：名称自适应，其余固定，窗口缩小时只压缩名称列。表头也用这一套。 */
export const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_8.5rem_4.5rem_20rem] items-center gap-4";

/** 缩略图缓存：文件名 + 修改时间不变就不重新生成。 */
const thumbnailCache = new Map<string, string | null>();

function Thumbnail({ item, load }: { item: ScreenshotItem; load: (name: string) => Promise<string | null> }) {
	const key = `${item.name}:${item.mtimeMs}`;
	const ref = useRef<HTMLDivElement>(null);
	const [src, setSrc] = useState<string | null | undefined>(() => thumbnailCache.get(key));

	useEffect(() => {
		if (thumbnailCache.has(key)) {
			setSrc(thumbnailCache.get(key));
			return;
		}
		setSrc(undefined);
		const element = ref.current;
		if (!element) return;
		let cancelled = false;
		// 滚动到可见区域才生成缩略图，截图多时不会一次性读取所有文件
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			void load(item.name)
				.catch(() => null)
				.then((value) => {
					thumbnailCache.set(key, value);
					if (!cancelled) setSrc(value);
				});
		});
		observer.observe(element);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [key, item.name, load]);

	return (
		<div
			ref={ref}
			className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-100 transition-transform duration-300 ease-out group-hover:scale-110"
		>
			{src ? (
				<img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
			) : src === null ? (
				<ImageOff size={20} className="text-gray-300" />
			) : (
				<div className="h-full w-full animate-pulse bg-gray-100" />
			)}
		</div>
	);
}

function stripExtension(name: string) {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

export function ScreenshotRow({ item, loadThumbnail, onAction, onRename }: ScreenshotRowProps) {
	const [renaming, setRenaming] = useState(false);
	const [draft, setDraft] = useState("");
	const submitting = useRef(false);

	const startRename = () => {
		setDraft(stripExtension(item.name));
		setRenaming(true);
	};

	const submitRename = async () => {
		if (submitting.current) return;
		const next = draft.trim();
		if (!next || next === stripExtension(item.name)) {
			setRenaming(false);
			return;
		}
		submitting.current = true;
		const done = await onRename(item, next);
		submitting.current = false;
		if (done) setRenaming(false);
	};

	const onRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") void submitRename();
		else if (event.key === "Escape") {
			// 只退出重命名，不触发外层的快捷键
			event.stopPropagation();
			setRenaming(false);
		}
	};

	return (
		<div
			className={`group ${ROW_GRID} rounded-2xl border-2 border-gray-100 bg-white px-4 py-3 shadow-sm transition-all hover:border-apple-blue/40 hover:shadow-md`}
			title="双击打开编辑"
			onDoubleClick={(event) => {
				if (!(event.target as HTMLElement).closest("button, input")) onAction("edit", item);
			}}
		>
			<div className="flex min-w-0 items-center gap-4">
				<Thumbnail item={item} load={loadThumbnail} />
				{renaming ? (
					<input
						autoFocus
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={onRenameKeyDown}
						onBlur={() => void submitRename()}
						onFocus={(event) => event.currentTarget.select()}
						className="min-w-0 flex-1 rounded-xl border-2 border-apple-orange/60 bg-white px-3 py-1.5 text-sm font-bold text-gray-800 shadow-inner focus:outline-none"
					/>
				) : (
					<span className="truncate text-sm font-bold text-gray-800" title={item.name}>
						{item.name}
					</span>
				)}
			</div>

			<div className="whitespace-nowrap text-sm font-medium text-gray-500">{formatDate(item.mtimeMs)}</div>

			<div className="whitespace-nowrap font-mono text-sm font-medium text-gray-500">
				{formatBytes(item.size)}
			</div>

			<div className="flex flex-nowrap items-center justify-end gap-2">
				<ActionChip tone="green" onClick={() => onAction("copy", item)}>
					复制图片
				</ActionChip>
				<ActionChip tone="purple" onClick={() => onAction("copyPath", item)}>
					复制路径
				</ActionChip>
				<ActionChip tone="orange" onClick={startRename}>
					重命名
				</ActionChip>
				<ActionChip tone="red" onClick={() => onAction("delete", item)}>
					删除
				</ActionChip>
				<button
					type="button"
					title="在文件夹中显示"
					className="shrink-0 rounded-xl p-1.5 text-gray-300 opacity-0 transition-all hover:bg-blue-50 hover:text-apple-blue group-hover:opacity-100"
					onClick={() => onAction("reveal", item)}
				>
					<FolderSearch size={18} />
				</button>
			</div>
		</div>
	);
}
