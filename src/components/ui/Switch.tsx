import type { ButtonHTMLAttributes } from "react";

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
	checked: boolean;
	onChange: (checked: boolean) => void;
}

/** 开关：开为绿色，滑块左右移动。 */
export function Switch({ checked, onChange, disabled, className = "", type = "button", ...props }: SwitchProps) {
	return (
		<button
			type={type}
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			className={`no-drag relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full shadow-inner transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40 disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-apple-green" : "bg-gray-200"
			} ${className}`}
			onClick={() => onChange(!checked)}
			{...props}
		>
			<span
				className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
					checked ? "translate-x-6" : "translate-x-1"
				}`}
			/>
		</button>
	);
}
