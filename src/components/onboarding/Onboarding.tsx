import {
	CircleAlert,
	CircleCheck,
	Keyboard,
	MonitorUp,
	MousePointerClick,
	PartyPopper,
	RotateCcw,
	Scan,
	Settings2,
	Terminal,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OnboardingState, OnboardingStep } from "../../../electron/ipcTypes";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { WindowControls } from "@/components/ui/WindowControls";
import { useI18n } from "@/i18n";
import { formatAccelerator } from "@/lib/accelerator";
import { mockOnboardingApi } from "@/lib/mockOnboarding";
import { isPermissionGranted, nextOnboardingStep, onboardingSteps, previousOnboardingStep } from "@/lib/onboardingSteps";
import { isMac } from "@/lib/platform";

/** 欢迎引导：介绍快捷键和开机自启，macOS 上申请屏幕录制权限。步骤由主进程决定，渲染进程也可以自己前进后退。 */
export function Onboarding() {
	const api = window.electronAPI ?? mockOnboardingApi;
	const { t } = useI18n();
	const text = t.onboarding;
	const [state, setState] = useState<OnboardingState | null>(null);
	const [step, setStep] = useState<OnboardingStep>("welcome");
	/** 主进程上次给的步骤：只在它变了时跟过去，权限状态之类的变化不打断用户自己翻到的那一步。 */
	const mainStepRef = useRef<OnboardingStep | null>(null);
	const [loginError, setLoginError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let disposed = false;
		const sync = async () => {
			const next = await api.getOnboardingState();
			if (disposed || !next) return;
			setState(next);
			if (next.step !== mainStepRef.current) {
				mainStepRef.current = next.step;
				setStep(next.step);
			}
		};
		void sync();
		const unsubscribe = api.onOnboardingChanged(() => void sync());
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [api]);

	if (!state) return <div className="h-full w-full bg-apple-canvas" />;

	const steps = onboardingSteps(isMac || step === "permission");
	const next = nextOnboardingStep(steps, step);
	const previous = previousOnboardingStep(steps, step);
	const shortcut = formatAccelerator(state.captureShortcut, isMac);
	const granted = isPermissionGranted(state.permission);

	const changeOpenAtLogin = async (enabled: boolean) => {
		const result = await api.setOpenAtLogin(enabled);
		if (!result.ok) {
			setLoginError(result.reason);
			return;
		}
		setLoginError(null);
		setState((current) => current && { ...current, openAtLogin: enabled });
	};

	const requestPermission = async () => {
		setBusy(true);
		try {
			const permission = await api.requestScreenPermission();
			setState((current) => current && { ...current, permission });
		} finally {
			setBusy(false);
		}
	};

	const finish = (capture: boolean) => void api.finishOnboarding(capture);

	let actions: ReactNode;
	if (step === "permission" && !granted && !state.dev?.fixture) {
		actions = (
			<>
				{next && (
					<button
						type="button"
						className="no-drag px-2 text-sm font-bold text-gray-400 transition-colors hover:text-gray-600"
						onClick={() => setStep(next)}
					>
						{text.skip}
					</button>
				)}
				<Button variant="secondary" onClick={() => void api.relaunchForPermission()}>
					<RotateCcw size={16} strokeWidth={2.5} />
					{text.permission.relaunch}
				</Button>
				<Button disabled={busy || state.permission === "restricted"} onClick={() => void requestPermission()}>
					<Settings2 size={16} strokeWidth={2.5} />
					{text.permission.request}
				</Button>
			</>
		);
	} else if (step === "done" || !next) {
		actions = (
			<>
				<Button variant="secondary" onClick={() => finish(false)}>
					{text.done.finish}
				</Button>
				<Button onClick={() => finish(true)}>
					<Scan size={16} strokeWidth={2.5} />
					{text.done.tryCapture}
				</Button>
			</>
		);
	} else {
		actions = <Button onClick={() => setStep(next)}>{text.next}</Button>;
	}

	return (
		<div className="flex h-full w-full select-none flex-col overflow-hidden bg-apple-canvas font-sans">
			{/* 标题栏：macOS 上左侧留给系统的红绿灯按钮，其他平台右侧自己画关闭按钮 */}
			<header className={`drag flex h-[52px] shrink-0 items-center ${isMac ? "pl-[88px] pr-4" : "pl-6 pr-3"}`}>
				<ol className="flex flex-1 items-center gap-2 text-xs font-black uppercase tracking-widest">
					{steps.map((item, index) => (
						<li key={item} className="flex items-center gap-2">
							{index > 0 && <span className="h-px w-5 bg-gray-200" />}
							<span className={item === step ? "text-apple-blue" : "text-gray-300"}>{text.steps[item]}</span>
						</li>
					))}
				</ol>
				{!isMac && <WindowControls onClose={() => void api.closeWindow()} />}
			</header>

			<main className="min-h-0 flex-1 overflow-y-auto px-14 pb-4 pt-2">
				{step === "welcome" && (
					<WelcomeStep
						state={state}
						shortcut={shortcut}
						loginError={loginError}
						onChangeOpenAtLogin={(enabled) => void changeOpenAtLogin(enabled)}
					/>
				)}
				{step === "permission" && <PermissionStep state={state} />}
				{step === "done" && <DoneStep shortcut={state.shortcutRegistered ? shortcut : null} />}
			</main>

			<footer className="flex shrink-0 items-center gap-3 border-t border-gray-200/60 bg-white/60 px-14 py-5">
				{previous && (
					<Button variant="secondary" onClick={() => setStep(previous)}>
						{text.back}
					</Button>
				)}
				<div className="flex flex-1 items-center justify-end gap-3">{actions}</div>
			</footer>
		</div>
	);
}

function StepHeading({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
	return (
		<div className="mb-6 flex items-center gap-5">
			<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.25rem] bg-white shadow-card">{icon}</div>
			<div className="min-w-0">
				<h1 className="text-2xl font-black tracking-tight text-gray-800">{title}</h1>
				<p className="mt-1 text-sm font-medium leading-relaxed text-gray-500">{subtitle}</p>
			</div>
		</div>
	);
}

/** 一张介绍卡片：图标、标题、说明。 */
function InfoCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
	return (
		<div className="flex flex-col rounded-2xl border-2 border-gray-100 bg-white p-4">
			<Icon size={20} strokeWidth={2.5} className="text-apple-blue" />
			<p className="mt-3 text-sm font-bold text-gray-700">{title}</p>
			<div className="mt-1 text-xs font-medium leading-relaxed text-gray-500">{children}</div>
		</div>
	);
}

function WelcomeStep({
	state,
	shortcut,
	loginError,
	onChangeOpenAtLogin,
}: {
	state: OnboardingState;
	shortcut: string;
	loginError: string | null;
	onChangeOpenAtLogin: (enabled: boolean) => void;
}) {
	const { t } = useI18n();
	const text = t.onboarding.welcome;
	return (
		<>
			<StepHeading
				icon={<img src="icon.png" alt="" draggable={false} className="h-12 w-12" />}
				title={text.title}
				subtitle={text.subtitle}
			/>
			<div className="grid grid-cols-3 gap-3">
				<InfoCard icon={Keyboard} title={text.shortcut}>
					<kbd className="mt-1 inline-block rounded-lg border-b-2 border-apple-key bg-gray-50 px-2.5 py-1 font-mono text-base font-bold text-gray-800">
						{shortcut}
					</kbd>
					{!state.shortcutRegistered && (
						<p className="mt-2 flex items-start gap-1 font-bold text-apple-orange">
							<CircleAlert size={12} className="mt-0.5 shrink-0" />
							{text.shortcutInUse}
						</p>
					)}
				</InfoCard>
				<InfoCard icon={MousePointerClick} title={text.clickTitle}>
					{text.clickDetail}
				</InfoCard>
				<InfoCard icon={Scan} title={text.dragTitle}>
					{text.dragDetail}
				</InfoCard>
			</div>
			<div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border-2 border-gray-100 bg-white px-4 py-3">
				<div className="min-w-0">
					<p className="text-sm font-bold text-gray-700">{text.openAtLogin}</p>
					<p className={`mt-0.5 text-xs font-medium ${loginError ? "text-apple-red" : "text-gray-400"}`}>
						{loginError ?? (state.openAtLoginSupported ? text.openAtLoginDetail : text.openAtLoginUnsupported)}
					</p>
				</div>
				<Switch
					aria-label={text.openAtLogin}
					checked={state.openAtLogin}
					disabled={!state.openAtLoginSupported}
					onChange={onChangeOpenAtLogin}
				/>
			</div>
		</>
	);
}

function PermissionStep({ state }: { state: OnboardingState }) {
	const { t } = useI18n();
	const text = t.onboarding.permission;
	const granted = isPermissionGranted(state.permission);
	return (
		<>
			<StepHeading
				icon={<MonitorUp size={30} strokeWidth={2.2} className="text-apple-blue" />}
				title={text.title}
				subtitle={text.subtitle}
			/>
			<div className="rounded-2xl border-2 border-gray-100 bg-white">
				<div className="flex items-center justify-between gap-4 px-4 py-3">
					<p className="text-sm font-bold text-gray-700">{text.status}</p>
					<span
						className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
							granted ? "bg-green-50 text-apple-green" : "bg-orange-50 text-apple-orange"
						}`}
					>
						{granted ? <CircleCheck size={14} strokeWidth={2.5} /> : <CircleAlert size={14} strokeWidth={2.5} />}
						{text.statuses[state.permission]}
					</span>
				</div>

				{granted ? (
					<p className="border-t-2 border-gray-100 px-4 py-3 text-sm font-bold text-apple-green">{text.grantedDetail}</p>
				) : state.permission === "restricted" ? (
					<p className="border-t-2 border-gray-100 px-4 py-3 text-sm font-bold text-apple-orange">{text.restrictedDetail}</p>
				) : (
					<ol className="space-y-2.5 border-t-2 border-gray-100 px-4 py-3.5">
						{[text.stepOpen, text.stepToggle, text.stepRelaunch].map((line, index) => (
							<li key={line} className="flex items-center gap-3 text-sm font-medium text-gray-600">
								<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-apple-blue text-xs font-black text-white">
									{index + 1}
								</span>
								{line}
							</li>
						))}
					</ol>
				)}
			</div>

			{state.dev && (state.dev.host || state.dev.fixture) && (
				<div className="mt-3 flex gap-3 rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50/60 px-4 py-3 text-xs font-medium leading-relaxed text-gray-600">
					<Terminal size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-apple-purple" />
					<div className="min-w-0 space-y-1">
						<p className="font-bold text-apple-purple">{text.devTitle}</p>
						{state.dev.host && <p>{text.devHost(state.dev.host)}</p>}
						{state.dev.fixture && <p>{text.devFixture}</p>}
					</div>
				</div>
			)}
		</>
	);
}

function DoneStep({ shortcut }: { shortcut: string | null }) {
	const { t } = useI18n();
	const text = t.onboarding.done;
	return (
		<div className="flex h-full flex-col items-center justify-center pb-6 text-center">
			<div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-card">
				<PartyPopper size={38} strokeWidth={2} className="text-apple-blue" />
			</div>
			<h1 className="mt-6 text-2xl font-black tracking-tight text-gray-800">{text.title}</h1>
			<p className="mt-2 max-w-md text-sm font-medium leading-relaxed text-gray-500">
				{shortcut ? text.subtitle(shortcut) : text.subtitleNoShortcut}
			</p>
			<p className="mt-1 max-w-md text-sm font-medium leading-relaxed text-gray-400">{text.tip}</p>
		</div>
	);
}
