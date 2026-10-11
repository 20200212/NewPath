import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	icon: LucideIcon;
	label: string;
	/** 显示在提示里的快捷键。 */
	shortcut?: string;
	active?: boolean;
}

/** 紧凑的图标按钮，用于编辑器工具栏；选中时是蓝色实体按键。 */
export function ToolButton({ icon: Icon, label, shortcut, active = false, className = "", type = "button", ...props }: ToolButtonProps) {
	return (
		<button
			type={type}
			title={shortcut ? `${label}（${shortcut}）` : label}
			aria-label={label}
			aria-pressed={active}
			className={`no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-150 active:scale-90 disabled:pointer-events-none disabled:opacity-35 ${
				active
					? "bg-apple-blue text-white shadow-key-blue-sm hover:bg-apple-blue-hover"
					: "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
			} ${className}`}
			{...props}
		>
			<Icon size={18} strokeWidth={2.25} />
		</button>
	);
}

/** 一组工具按钮的白色底板。 */
export function ToolGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div className={`no-drag flex shrink-0 items-center gap-0.5 rounded-2xl border border-gray-200/80 bg-white p-1 shadow-sm ${className}`}>
			{children}
		</div>
	);
}

/** 文字小按钮（样式条、缩放条里的选项），选中时浅蓝底。 */
export function ChipButton({
	active = false,
	className = "",
	type = "button",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
	return (
		<button
			type={type}
			className={`no-drag flex h-8 shrink-0 items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-bold transition-all duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-35 ${
				active ? "bg-apple-blue/10 text-apple-blue" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
			} ${className}`}
			{...props}
		/>
	);
}
