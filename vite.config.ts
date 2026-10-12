import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import { rendererConfig } from "./vite.renderer.config";

export default defineConfig((env) =>
	mergeConfig(rendererConfig(env), {
		plugins: [
			electron({
				main: {
					entry: {
						main: fileURLToPath(new URL("./electron/main.ts", import.meta.url)),
						// 滚动截图的拼接线程（Windows），单独一个入口，主进程以 data: URL 启动它
						scrollWorker: fileURLToPath(new URL("./electron/scrollWorker.ts", import.meta.url)),
					},
				},
				preload: { input: fileURLToPath(new URL("./electron/preload.ts", import.meta.url)) },
			}),
		],
	}),
);
