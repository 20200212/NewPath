import { CheckCircle2, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "success" | "error";

interface ToastState {
	id: number;
	message: string;
	tone: ToastTone;
}

const DURATION_MS = 3000;

/** 底部提示条的状态；同一时间只显示最新的一条。 */
export function useToast() {
	const [toast, setToast] = useState<ToastState | null>(null);
	const seq = useRef(0);

	const showToast = useCallback((message: string, tone: ToastTone = "success") => {
		setToast({ id: ++seq.current, message, tone });
	}, []);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), DURATION_MS);
		return () => window.clearTimeout(timer);
	}, [toast]);

	return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
	if (!toast) return null;
	const Icon = toast.tone === "success" ? CheckCircle2 : CircleAlert;
	return (
		<div
			key={toast.id}
			role="status"
			className="pointer-events-none fixed bottom-10 left-1/2 z-50 flex max-w-[80vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#1C1C1E]/90 px-6 py-3 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-8"
		>
			<Icon size={20} className={`shrink-0 ${toast.tone === "success" ? "text-apple-green" : "text-apple-red"}`} />
			<span className="truncate text-sm font-bold tracking-wide">{toast.message}</span>
		</div>
	);
}
