import { Editor } from "./components/editor/Editor";
import { RegionSelector } from "./components/screenshot/RegionSelector";

/** 所有窗口共用一个页面，主进程通过 ?windowType= 决定渲染哪个界面。 */
const windowType = new URLSearchParams(window.location.search).get("windowType") ?? "";

export default function App() {
	switch (windowType) {
		case "screenshot-region":
			return <RegionSelector />;
		case "screenshot-preview":
			return <Editor />;
		default:
			return (
				<div className="flex h-screen items-center justify-center bg-zinc-900 text-sm text-zinc-400">
					在地址后加上 ?windowType=screenshot-region 或 ?windowType=screenshot-preview
				</div>
			);
	}
}
