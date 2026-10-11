/// <reference types="vite/client" />

interface Window {
	/** 由 electron/preload.ts 注入；纯浏览器调试（dev:ui）时不存在。 */
	electronAPI?: import("../electron/preload").ElectronAPI;
}
