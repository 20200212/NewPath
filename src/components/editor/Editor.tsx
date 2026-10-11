import { Copy, Download, FolderOutput, ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/ui/Toast";
import { WindowControls } from "@/components/ui/WindowControls";
import { exportPng } from "@/editor/exportImage";
import { createMockScreenshot } from "@/lib/mockImage";

/** 编辑窗口：目前只有预览、复制和保存，标注工具后续在这里扩展。 */
export function Editor() {
	const api = window.electronAPI;
	const [src, setSrc] = useState<string | null>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	const { toast, showToast } = useToast();

	useEffect(() => {
		if (!api) {
			setSrc(createMockScreenshot(960, 540));
			return;
		}
		void api.getPreviewImage().then(setSrc);
	}, [api]);

	const copy = useCallback(async () => {
		if (!src) return;
		const png = await exportPng(src);
		if (api) await api.copyImage(png);
		showToast("已复制到剪贴板");
	}, [api, src, showToast]);

	const save = useCallback(
		async (as: boolean) => {
			if (!src) return;
			const png = await exportPng(src);
			if (!api) return showToast("dev:ui 模式下不支持保存", "error");
			const result = await (as ? api.saveImageAs(png) : api.saveImage(png));
			if (result.saved) showToast(`已保存：${result.filePath}`);
		},
		[api, src, showToast],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			if (mod && event.key.toLowerCase() === "c") void copy();
			else if (mod && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void save(event.shiftKey);
			} else if (event.key === "Escape") void api?.closeWindow();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [api, copy, save]);

	return (
		<div className="flex h-screen select-none flex-col overflow-hidden bg-apple-canvas">
			<header className="drag flex shrink-0 items-center gap-3 border-b border-gray-200/50 bg-white/60 px-5 py-4 backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-2">
					<div className="rounded-xl bg-apple-blue/10 p-2 text-apple-blue">
						<ImageIcon size={18} strokeWidth={2.5} />
					</div>
					<span className="text-base font-black tracking-tight text-gray-800">编辑截图</span>
					{size && (
						<span className="ml-1 rounded-lg bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-500">
							{size.width} × {size.height}
						</span>
					)}
				</div>

				<div className="ml-auto flex items-center gap-3">
					<Button variant="secondary" size="sm" title="复制（Ctrl+C）" onClick={() => void copy()}>
						<Copy size={16} strokeWidth={2.5} />
						复制
					</Button>
					<Button variant="secondary" size="sm" title="另存为（Ctrl+Shift+S）" onClick={() => void save(true)}>
						<FolderOutput size={16} strokeWidth={2.5} />
						另存为
					</Button>
					<Button size="sm" title="保存到截图库（Ctrl+S）" onClick={() => void save(false)}>
						<Download size={16} strokeWidth={2.5} />
						保存
					</Button>
				</div>

				<div className="h-8 w-px shrink-0 bg-gray-200" />
				<WindowControls onMinimize={() => void api?.minimizeWindow()} onClose={() => void api?.closeWindow()} />
			</header>

			<main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
				{src && (
					<div className="max-h-full max-w-full rounded-2xl border-2 border-white bg-white p-2 shadow-card">
						<img
							src={src}
							alt="截图"
							draggable={false}
							className="max-h-[calc(100vh-10rem)] max-w-full rounded-xl"
							onLoad={(event) =>
								setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
							}
						/>
					</div>
				)}
			</main>
			<Toast toast={toast} />
		</div>
	);
}
