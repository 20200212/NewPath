import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "icon";
type Size = "md" | "sm";

/** 实体按键风格：底部实色阴影当作按键侧面，悬停上浮，按下时压平。 */
const BASE =
	"group no-drag inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-1 active:shadow-none disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-apple-blue text-white shadow-key-blue hover:bg-apple-blue-hover hover:shadow-key-blue-hover",
	secondary:
		"border-2 border-gray-100 bg-white text-gray-700 shadow-key-gray hover:bg-gray-50 hover:shadow-key-gray-hover",
	icon: "border-2 border-gray-100 bg-white text-gray-500 shadow-key-gray hover:text-apple-blue hover:shadow-key-gray-hover",
};

const SIZES: Record<Variant, Record<Size, string>> = {
	primary: { md: "px-5 py-3 text-sm", sm: "px-4 py-2 text-sm" },
	secondary: { md: "px-5 py-3 text-sm", sm: "px-4 py-2 text-sm" },
	icon: { md: "p-3", sm: "p-2" },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
	return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${SIZES[variant][size]} ${className}`} {...props} />;
}

type Tone = "green" | "purple" | "orange" | "red";

const TONES: Record<Tone, string> = {
	green: "hover:border-green-300 hover:bg-green-50 hover:text-apple-green",
	purple: "hover:border-purple-300 hover:bg-purple-50 hover:text-apple-purple",
	orange: "origin-bottom-left hover:-rotate-2 hover:border-orange-300 hover:bg-orange-50 hover:text-apple-orange",
	red: "origin-bottom-right hover:rotate-2 hover:border-red-300 hover:bg-red-50 hover:text-apple-red",
};

interface ActionChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	tone: Tone;
}

/** 列表行里的文字小按钮，悬停时按语义上色。 */
export function ActionChip({ tone, className = "", type = "button", ...props }: ActionChipProps) {
	return (
		<button
			type={type}
			className={`shrink-0 whitespace-nowrap rounded-xl border-b-2 border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-600 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0.5 active:scale-95 active:border-b-0 ${TONES[tone]} ${className}`}
			{...props}
		/>
	);
}
