import { ArrowUp } from "lucide-react";
import { useI18n } from "@/i18n";
import { mockPermissionHelperApi } from "@/lib/mockOnboarding";

/**
 * 授权时贴在系统设置下方的小窗：拖动左边的图标就是拖动 NewPath.app 本身，
 * 放进“屏幕录制”列表即可授权。窗口不可聚焦，系统设置一直在前台。
 */
export function PermissionHelper() {
	const api = window.electronAPI ?? mockPermissionHelperApi;
	const { t } = useI18n();
	const text = t.onboarding.helper;

	return (
		<div className="flex h-full w-full select-none items-center p-2">
			<div className="flex h-full w-full items-center gap-3 rounded-[18px] border border-white/10 bg-[#1C1C1E]/95 pl-2.5 pr-4 text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<span
					draggable
					title={text.dragTitle}
					className="flex h-[62px] w-[62px] shrink-0 cursor-grab items-center justify-center rounded-2xl border-2 border-dashed border-apple-blue/70 bg-white/5 transition-colors hover:bg-white/10 active:cursor-grabbing"
					onDragStart={(event) => {
						// 拖的是应用本身，由主进程用 webContents.startDrag 发起
						event.preventDefault();
						api.startPermissionDrag();
					}}
				>
					<img src="icon.png" alt="NewPath" draggable={false} className="pointer-events-none h-12 w-12" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5 text-[13px] font-bold">
						<span className="truncate">{text.title}</span>
						<ArrowUp size={15} strokeWidth={2.5} className="shrink-0 animate-bounce text-apple-blue" />
					</span>
					<span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-white/65">{text.detail}</span>
				</span>
			</div>
		</div>
	);
}
