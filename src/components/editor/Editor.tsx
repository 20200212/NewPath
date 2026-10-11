import { useCallback, useEffect, useState } from "react";
import { exportPng } from "@/editor/exportImage";
import { createMockScreenshot } from "@/lib/mockImage";

/** 编辑窗口：目前只有预览、复制和保存，标注工具后续在这里扩展。 */
export function Editor() {
	const api = window.electronAPI;
	const [src, setSrc] = useState<string | null>(null);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (!api) {
			setSrc(createMockScreenshot(960, 540));
			return;
		}
		void api.getPreviewImage().then(setSrc);
	}, [api]);

	useEffect(() => {
		if (!status) return;
		const timer = window.setTimeout(() => setStatus(""), 2000);
		return () => window.clearTimeout(timer);
	}, [status]);

	const copy = useCallback(async () => {
		if (!src) return;
		const png = await exportPng(src);
		if (api) await api.copyImage(png);
		setStatus("已复制到剪贴板");
	}, [api, src]);

	const save = useCallback(async () => {
		if (!src) return;
		const png = await exportPng(src);
		if (!api) return setStatus("dev:ui 模式下不支持保存");
		const result = await api.saveImage(png);
		if (result.saved) setStatus(`已保存：${result.filePath}`);
	}, [api, src]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			if (mod && event.key.toLowerCase() === "c") void copy();
			else if (mod && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void save();
			} else if (event.key === "Escape") void api?.closeWindow();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [api, copy, save]);

	return (
		<div className="flex h-screen flex-col bg-zinc-900 text-zinc-100">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
				<span className="mr-auto text-sm text-zinc-400">{status}</span>
				<button type="button" className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10" onClick={copy}>
					复制
				</button>
				<button
					type="button"
					className="rounded-md bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500"
					onClick={save}
				>
					保存
				</button>
			</header>
			<main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
				{src && (
					<img
						src={src}
						alt="截图"
						draggable={false}
						className="max-h-full max-w-full rounded shadow-2xl shadow-black/60"
					/>
				)}
			</main>
		</div>
	);
}
