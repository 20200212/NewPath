import { Minus, Square, X } from "lucide-react";
import { useI18n } from "@/i18n";

interface WindowControlsProps {
	onMinimize: () => void;
	/** 传入时显示最大化 / 还原按钮。 */
	onMaximize?: () => void;
	onClose: () => void;
}

/** 无边框窗口右上角的最小化 / 最大化 / 关闭按钮。 */
export function WindowControls({ onMinimize, onMaximize, onClose }: WindowControlsProps) {
	const { t } = useI18n();
	return (
		<div className="no-drag flex shrink-0 items-center gap-1">
			<button
				type="button"
				title={t.common.minimize}
				className="rounded-xl p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700 active:scale-90"
				onClick={onMinimize}
			>
				<Minus size={18} strokeWidth={2.5} />
			</button>
			{onMaximize && (
				<button
					type="button"
					title={t.common.maximizeRestore}
					className="rounded-xl p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700 active:scale-90"
					onClick={onMaximize}
				>
					<Square size={15} strokeWidth={2.5} />
				</button>
			)}
			<button
				type="button"
				title={t.common.close}
				className="group rounded-xl p-2 text-gray-400 transition-all hover:bg-red-50 hover:text-apple-red active:scale-90"
				onClick={onClose}
			>
				<X size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:rotate-90" />
			</button>
		</div>
	);
}
