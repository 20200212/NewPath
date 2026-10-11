import { defineConfig } from "vite";
import { rendererConfig } from "./vite.renderer.config";

/**
 * 只启动渲染层，不启动 Electron。
 * 浏览器打开 http://localhost:5174/?windowType=screenshot-region 即可调试 UI，
 * 此时 window.electronAPI 不存在，组件会退回到 mock 数据。
 */
export default defineConfig((env) => ({
	...rendererConfig(env),
	server: { port: 5174 },
}));
