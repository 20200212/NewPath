import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ActionResult } from "../../../electron/ipcTypes";
import { acceleratorFromKey, formatAccelerator } from "@/lib/accelerator";

interface ShortcutRecorderProps {
	value: string;
	mac: boolean;
	onChange: (accelerator: string) => Promise<ActionResult>;
	/** 聚焦时暂停全局快捷键，失焦时恢复。 */
	onRecordingChange: (recording: boolean) => void;
}

/** 点击后直接按下组合键录制；Esc 取消。 */
export function ShortcutRecorder({ value, mac, onChange, onRecordingChange }: ShortcutRecorderProps) {
	const [recording, setRecording] = useState(false);
	const [pending, setPending] = useState<string[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const onKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
		event.preventDefault();
		// 不让 Esc 冒泡到弹窗，否则会把整个设置窗口关掉
		event.stopPropagation();
		if (busy) return;
		if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
			event.currentTarget.blur();
			return;
		}

		const result = acceleratorFromKey(event, mac);
		if (result.status === "pending") {
			setPending(result.modifiers);
			setError("");
			return;
		}
		setPending([]);
		if (result.status === "invalid") {
			setError(result.reason);
			return;
		}

		const input = event.currentTarget;
		setBusy(true);
		const outcome = await onChange(result.accelerator);
		setBusy(false);
		if (outcome.ok) {
			setError("");
			input.blur();
		} else {
			setError(outcome.reason);
		}
	};

	const display = recording
		? pending.length
			? `${pending.map(formatAccelerator).join(" + ")} + …`
			: "请按下组合键…"
		: formatAccelerator(value);

	return (
		<div className="flex flex-col items-end gap-1.5">
			<input
				type="text"
				readOnly
				value={display}
				title="点击后按下新的组合键，Esc 取消"
				className={`w-44 cursor-pointer rounded-xl border-2 bg-white px-3 py-2 text-center text-sm font-bold shadow-inner transition-all focus:outline-none ${
					error
						? "border-apple-red text-apple-red"
						: "border-gray-200 text-gray-800 focus:border-apple-blue focus:text-apple-blue"
				}`}
				onFocus={() => {
					setRecording(true);
					setError("");
					onRecordingChange(true);
				}}
				onBlur={() => {
					setRecording(false);
					setPending([]);
					onRecordingChange(false);
				}}
				onKeyDown={(event) => void onKeyDown(event)}
				onKeyUp={() => setPending([])}
			/>
			{error && <span className="text-xs font-bold text-apple-red">{error}</span>}
		</div>
	);
}
