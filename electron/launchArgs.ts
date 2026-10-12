// 命令行入口，方便自动化验收和脚本调用。已经在运行时再次启动（macOS 上 open -n NewPath.app --args …），
// 参数会经 second-instance 交给正在运行的那个实例。
//   --capture / --capture-region   开始截图
//   --capture-scroll               直接进入滚动截图（macOS 14 起）
//   --onboarding                   打开欢迎引导
//   --show                         打开主界面

export type LaunchCommand = "capture" | "capture-scroll" | "onboarding" | "show";

/** 取第一个认识的命令；没有时返回 null。 */
export function launchCommandFromArgs(argv: readonly string[]): LaunchCommand | null {
	for (const arg of argv) {
		if (arg === "--capture" || arg === "--capture-region") return "capture";
		if (arg === "--capture-scroll") return "capture-scroll";
		if (arg === "--onboarding") return "onboarding";
		if (arg === "--show") return "show";
	}
	return null;
}
