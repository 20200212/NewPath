import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

export interface SelectOption<T extends string> {
	value: T;
	label: string;
}

interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
	value: T;
	options: readonly SelectOption<T>[];
	onChange: (value: T) => void;
}

/** 原生下拉框，去掉系统外观后配一个箭头图标；尺寸和 ShortcutRecorder 一致。 */
export function Select<T extends string>({ value, options, onChange, className = "", ...props }: SelectProps<T>) {
	return (
		<div className={`no-drag relative w-44 shrink-0 ${className}`}>
			<select
				value={value}
				onChange={(event) => onChange(event.target.value as T)}
				className="w-full cursor-pointer appearance-none rounded-xl border-2 border-gray-100 bg-white py-2 pl-3 pr-9 text-sm font-bold text-gray-800 shadow-inner transition-all hover:border-gray-200 focus:border-apple-blue focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				{...props}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<ChevronDown
				size={16}
				strokeWidth={2.5}
				className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
			/>
		</div>
	);
}
