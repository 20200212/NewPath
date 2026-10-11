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
		opacityTitle: "透明度（Ctrl+滚轮）",
		copyTitle: "复制（Ctrl+C）",
		saveTitle: "保存到截图库（Ctrl+S）",
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
			opacityTitle: "透明度（Ctrl+滾輪）",
			copyTitle: "複製（Ctrl+C）",
			saveTitle: "儲存到截圖庫（Ctrl+S）",
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
			opacityTitle: "Opacity (Ctrl+scroll)",
			copyTitle: "Copy (Ctrl+C)",
			saveTitle: "Save to library (Ctrl+S)",
			closeTitle: "Close (Esc / double-click)",
		},
	},
};
