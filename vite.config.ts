import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import { rendererConfig } from "./vite.renderer.config";

export default defineConfig((env) =>
	mergeConfig(rendererConfig(env), {
		plugins: [
			electron({
				main: { entry: fileURLToPath(new URL("./electron/main.ts", import.meta.url)) },
				preload: { input: fileURLToPath(new URL("./electron/preload.ts", import.meta.url)) },
			}),
		],
	}),
);
