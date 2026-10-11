import { Editor } from "./components/editor/Editor";
import { MainWindow } from "./components/main/MainWindow";
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
			// "main"，以及 dev:ui 下不带参数直接打开
			return <MainWindow />;
	}
}
