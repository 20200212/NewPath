import { Minus, X } from "lucide-react";

interface WindowControlsProps {
	onMinimize: () => void;
	onClose: () => void;
}

/** 无边框窗口右上角的最小化 / 关闭按钮。 */
export function WindowControls({ onMinimize, onClose }: WindowControlsProps) {
	return (
		<div className="no-drag flex shrink-0 items-center gap-1">
			<button
				type="button"
				title="最小化"
				className="rounded-xl p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700 active:scale-90"
				onClick={onMinimize}
			>
				<Minus size={18} strokeWidth={2.5} />
			</button>
			<button
				type="button"
				title="关闭"
				className="group rounded-xl p-2 text-gray-400 transition-all hover:bg-red-50 hover:text-apple-red active:scale-90"
				onClick={onClose}
			>
				<X size={18} strokeWidth={2.5} className="transition-transform duration-300 group-hover:rotate-90" />
			</button>
		</div>
	);
}
