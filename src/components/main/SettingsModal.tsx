import { CircleAlert, Keyboard, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { ActionResult, SettingsState } from "../../../electron/ipcTypes";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ShortcutRecorder } from "./ShortcutRecorder";

interface SettingsModalProps {
	settings: SettingsState;
	mac: boolean;
	onClose: () => void;
	onChangeShortcut: (accelerator: string) => Promise<ActionResult>;
	onRecordingChange: (recording: boolean) => void;
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
			{icon}
			{children}
		</h3>
	);
}

export function SettingsModal({ settings, mac, onClose, onChangeShortcut, onRecordingChange }: SettingsModalProps) {
	return (
		<Modal
			title="偏好设置"
			icon={<Settings size={24} className="text-apple-blue" />}
			onClose={onClose}
			footer={<Button onClick={onClose}>完成</Button>}
		>
			<section>
				<SectionTitle icon={<Keyboard size={16} />}>快捷键</SectionTitle>
				<div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3">
					<div className="min-w-0">
						<p className="text-sm font-bold text-gray-700">开始截图</p>
						{!settings.shortcutRegistered && (
							<p className="mt-1 flex items-center gap-1 text-xs font-bold text-apple-orange">
								<CircleAlert size={12} /> 当前快捷键被占用，请换一个
							</p>
						)}
					</div>
					<ShortcutRecorder
						value={settings.captureShortcut}
						mac={mac}
						onChange={onChangeShortcut}
						onRecordingChange={onRecordingChange}
					/>
				</div>
			</section>
		</Modal>
	);
}
