import { CircleAlert, CircleCheck, Keyboard, Settings, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { ActionResult, LanguageSetting, Locale, SelectionMode, SettingsState } from "../../../electron/ipcTypes";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useI18n } from "@/i18n";
import { ShortcutRecorder } from "./ShortcutRecorder";

interface SettingsModalProps {
	settings: SettingsState;
	mac: boolean;
	onClose: () => void;
	onChangeShortcut: (accelerator: string) => Promise<ActionResult>;
	onRecordingChange: (recording: boolean) => void;
	onChangeLanguage: (language: LanguageSetting) => void;
	onChangeOpenAtLogin: (enabled: boolean) => void;
	/** 只在 macOS 上显示。 */
	onChangeSelectionMode: (mode: SelectionMode) => void;
	onOpenOnboarding: () => void;
	onOpenLogs: () => void;
}

/** 语言名始终用该语言自身的写法，不随界面语言翻译。 */
const LANGUAGE_NAMES: Record<Locale, string> = {
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
	en: "English",
};

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
			{icon}
			{children}
		</h3>
	);
}

/** 一行设置：左边名称和提示，右边控件。 */
function SettingRow({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3">
			<div className="min-w-0">
				<p className="text-sm font-bold text-gray-700">{label}</p>
				{note}
			</div>
			{children}
		</div>
	);
}

export function SettingsModal({
	settings,
	mac,
	onClose,
	onChangeShortcut,
	onRecordingChange,
	onChangeLanguage,
	onChangeOpenAtLogin,
	onChangeSelectionMode,
	onOpenOnboarding,
	onOpenLogs,
}: SettingsModalProps) {
	const { t } = useI18n();
	const text = t.main.settings;
	const selectionOptions: { value: SelectionMode; label: string }[] = [
		{ value: "overlay", label: text.selectionOverlay },
		{ value: "system", label: text.selectionSystem },
	];
	const permissionGranted = settings.screenPermission === "granted";
	const languageOptions: { value: LanguageSetting; label: string }[] = [
		{ value: "system", label: t.main.settings.languageSystem },
		...(Object.keys(LANGUAGE_NAMES) as Locale[]).map((locale) => ({ value: locale, label: LANGUAGE_NAMES[locale] })),
	];

	return (
		<Modal
			title={t.main.settings.title}
			icon={<Settings size={24} className="text-apple-blue" />}
			onClose={onClose}
			footer={<Button onClick={onClose}>{t.common.done}</Button>}
		>
			<div className="space-y-8">
				<section>
					<SectionTitle icon={<SlidersHorizontal size={16} />}>{t.main.settings.general}</SectionTitle>
					<div className="space-y-3">
						<SettingRow label={t.main.settings.language}>
							<Select
								aria-label={t.main.settings.language}
								value={settings.language}
								options={languageOptions}
								onChange={onChangeLanguage}
							/>
						</SettingRow>
						<SettingRow
							label={t.main.settings.openAtLogin}
							note={
								!settings.openAtLoginSupported && (
									<p className="mt-1 text-xs font-medium text-gray-400">
										{t.main.settings.openAtLoginUnsupported}
									</p>
								)
							}
						>
							<Switch
								aria-label={t.main.settings.openAtLogin}
								checked={settings.openAtLogin}
								disabled={!settings.openAtLoginSupported}
								onChange={onChangeOpenAtLogin}
							/>
						</SettingRow>
						{mac && (
							<SettingRow
								label={text.selectionMode}
								note={
									settings.selectionMode === "system" && (
										<p className="mt-1 text-xs font-medium leading-relaxed text-gray-400">{text.selectionSystemNote}</p>
									)
								}
							>
								<Select
									aria-label={text.selectionMode}
									value={settings.selectionMode}
									options={selectionOptions}
									onChange={onChangeSelectionMode}
								/>
							</SettingRow>
						)}
					</div>
				</section>

				<section>
					<SectionTitle icon={<Keyboard size={16} />}>{t.main.settings.shortcuts}</SectionTitle>
					<SettingRow
						label={t.main.settings.captureShortcut}
						note={
							!settings.shortcutRegistered && (
								<p className="mt-1 flex items-center gap-1 text-xs font-bold text-apple-orange">
									<CircleAlert size={12} /> {t.main.settings.shortcutInUse}
								</p>
							)
						}
					>
						<ShortcutRecorder
							value={settings.captureShortcut}
							mac={mac}
							onChange={onChangeShortcut}
							onRecordingChange={onRecordingChange}
						/>
					</SettingRow>
				</section>

				<section>
					<SectionTitle icon={<ShieldCheck size={16} />}>{text.diagnostics}</SectionTitle>
					<div className="space-y-3">
						{mac && (
							<SettingRow
								label={text.screenPermission}
								note={
									<p
										className={`mt-1 flex items-center gap-1 text-xs font-bold ${permissionGranted ? "text-apple-green" : "text-apple-orange"}`}
									>
										{permissionGranted ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
										{permissionGranted ? text.permissionGranted : text.permissionMissing}
									</p>
								}
							>
								<Button variant={permissionGranted ? "secondary" : "primary"} size="sm" onClick={onOpenOnboarding}>
									{permissionGranted ? text.permissionCheck : text.permissionFix}
								</Button>
							</SettingRow>
						)}
						<SettingRow
							label={text.onboarding}
							note={<p className="mt-1 text-xs font-medium text-gray-400">{text.onboardingNote}</p>}
						>
							<Button variant="secondary" size="sm" onClick={onOpenOnboarding}>
								{text.openOnboarding}
							</Button>
						</SettingRow>
						<SettingRow label={text.logs} note={<p className="mt-1 text-xs font-medium text-gray-400">{text.logsNote}</p>}>
							<Button variant="secondary" size="sm" onClick={onOpenLogs}>
								{text.openLogs}
							</Button>
						</SettingRow>
					</div>
				</section>
			</div>
		</Modal>
	);
}
