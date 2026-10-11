import type { Locale } from "../../../electron/ipcTypes";

/** 选区窗口和钉图窗口。 */
const zhCN = {
	region: {
		hintCapture: "单击选择窗口，拖动选择区域",
		hintStitch: "选择要拼接的区域",
		hintEsc: "Esc 退出",
		addToStitch: "添加到拼接",
		cancel: "取消",
		edit: "编辑",
		save: "保存",
		copyPath: "复制路径",
		copyImage: "复制图片",
		pin: "钉住",
	},
	pin: {
		alt: "钉图",
		copied: "已复制",
		saved: "已保存到截图库",
		opacityHint: (percent: number) => `透明度 ${percent}%`,
		opacityTitle: (mod: string) => `透明度（${mod}+滚轮）`,
		copyTitle: (keys: string) => `复制（${keys}）`,
		saveTitle: (keys: string) => `保存到截图库（${keys}）`,
		closeTitle: "关闭（Esc / 双击）",
	},
};

export const capture: Record<Locale, typeof zhCN> = {
	"zh-CN": zhCN,
	"zh-TW": {
		region: {
			hintCapture: "按一下選擇視窗，拖曳選擇區域",
			hintStitch: "選擇要拼接的區域",
			hintEsc: "Esc 結束",
			addToStitch: "加入拼接",
			cancel: "取消",
			edit: "編輯",
			save: "儲存",
			copyPath: "複製路徑",
			copyImage: "複製圖片",
			pin: "釘選",
		},
		pin: {
			alt: "釘圖",
			copied: "已複製",
			saved: "已儲存到截圖庫",
			opacityHint: (percent: number) => `透明度 ${percent}%`,
			opacityTitle: (mod: string) => `透明度（${mod}+滾輪）`,
			copyTitle: (keys: string) => `複製（${keys}）`,
			saveTitle: (keys: string) => `儲存到截圖庫（${keys}）`,
			closeTitle: "關閉（Esc / 按兩下）",
		},
	},
	en: {
		region: {
			hintCapture: "Click to select a window, drag to select an area",
			hintStitch: "Select an area to stitch",
			hintEsc: "Esc to exit",
			addToStitch: "Add to stitch",
			cancel: "Cancel",
			edit: "Edit",
			save: "Save",
			copyPath: "Copy path",
			copyImage: "Copy image",
			pin: "Pin",
		},
		pin: {
			alt: "Pinned screenshot",
			copied: "Copied",
			saved: "Saved to library",
			opacityHint: (percent: number) => `Opacity ${percent}%`,
			opacityTitle: (mod: string) => `Opacity (${mod}+scroll)`,
			copyTitle: (keys: string) => `Copy (${keys})`,
			saveTitle: (keys: string) => `Save to library (${keys})`,
			closeTitle: "Close (Esc / double-click)",
		},
	},
};
