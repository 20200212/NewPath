import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useI18n } from "@/i18n";

interface ModalProps {
	title: string;
	icon?: ReactNode;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
}

/** 毛玻璃弹窗，Esc 或点击遮罩关闭。 */
export function Modal({ title, icon, onClose, children, footer }: ModalProps) {
	const { t } = useI18n();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div
			className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-sm animate-in fade-in"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-label={title}
				className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-white bg-white/90 shadow-2xl backdrop-blur-xl animate-in zoom-in-95"
			>
				<div className="flex items-center justify-between border-b border-gray-200/50 px-6 py-5">
					<h2 className="flex items-center gap-2 text-xl font-black tracking-tight text-gray-800">
						{icon}
						{title}
					</h2>
					<button
						type="button"
						title={t.common.close}
						className="group rounded-full bg-gray-100 p-2 text-gray-400 transition-all hover:bg-red-50 hover:text-apple-red active:scale-90"
						onClick={onClose}
					>
						<X size={20} className="transition-transform duration-300 group-hover:rotate-90" />
					</button>
				</div>
				<div className="min-h-0 overflow-y-auto p-6">{children}</div>
				{footer && <div className="flex justify-end border-t border-gray-200/50 bg-gray-50/50 px-6 py-5">{footer}</div>}
			</div>
		</div>
	);
}
