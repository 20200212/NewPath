import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { ConfigEnv, UserConfig } from "vite";

/** Electron 渲染进程与纯浏览器调试（dev:ui）共用的构建配置。 */
export function rendererConfig({ command }: ConfigEnv): UserConfig {
	return {
		// 打包后通过 file:// 加载，必须使用相对路径
		base: command === "build" ? "./" : "/",
		plugins: [react()],
		resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
		build: { target: "esnext" },
	};
}
