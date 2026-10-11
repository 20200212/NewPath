import type { Locale } from "./ipcTypes";

/** 主进程里给用户看的文案（托盘、对话框、通知、错误原因）。以简体中文为准，其他语言缺 key 时类型检查不过。 */
const zhCN = {
	trayTooltip: "NewPath 截图",
	trayOpenMain: "打开主界面",
	trayCapture: "截图",
	trayCaptureNoShortcut: "截图（快捷键不可用）",
	trayCloseAllPins: "关闭所有钉图",
	trayQuit: "退出",
	openAtLoginUnsupported: "开机自启仅在安装版中可用",
	invalidArgument: "参数无效",
	// 窗口标题
	previewWindowTitle: "NewPath 编辑",
	pinWindowTitle: "NewPath 钉图",
	// 截图与保存
	captureFailedTitle: "无法截图",
	captureFailedMacPermission: "请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 NewPath，然后重启应用。",
	captureFailedRetry: "未能获取屏幕画面，请重试。",
	saveFailedTitle: "保存失败",
	saveFailedMessage: (dir: string, error: string) => `无法写入 ${dir}\n${error}`,
	pngFilterName: "PNG 图片",
	chooseSaveDirTitle: "选择截图保存位置",
	notifySaved: "截图已保存",
	notifySavedPathCopied: "截图已保存，路径已复制",
	/** 默认文件名的前缀，例如“截图 2026-10-11 153045.png”。 */
	screenshotFilePrefix: "截图",
	// 截图库
	invalidFileName: "文件名无效",
	fileNotFound: "文件已不存在",
	operationFailed: (code: string) => `操作失败（${code}）`,
	invalidImageData: "图片数据无效",
	cannotReadImage: "无法读取图片",
	fileNameExists: (name: string) => `已存在同名文件 ${name}`,
	fileNameEmpty: "文件名不能为空",
	fileNameInvalidChars: '文件名不能包含 \\ / : * ? " < > |',
	fileNameTrailing: "文件名不能以空格或句点结尾",
	fileNameReserved: "这是系统保留的文件名",
	fileNameTooLong: "文件名太长",
	// 快捷键
	invalidShortcut: "快捷键无效",
	shortcutUnavailable: (accelerator: string) => `${accelerator} 无法使用，可能已被其他程序占用`,
	// 文字识别
	ocrUnsupported: "当前系统暂不支持文字识别",
	ocrNoLanguage: "系统没有可用的文字识别语言，请在“设置 → 时间和语言 → 语言”中添加中文或英文语言包",
	ocrFailed: "文字识别失败",
	ocrFailedRetry: "文字识别失败，请重试",
};

type MainMessages = typeof zhCN;

const zhTW: MainMessages = {
	trayTooltip: "NewPath 截圖",
	trayOpenMain: "開啟主介面",
	trayCapture: "截圖",
	trayCaptureNoShortcut: "截圖（快速鍵無法使用）",
	trayCloseAllPins: "關閉所有釘圖",
	trayQuit: "結束",
	openAtLoginUnsupported: "開機自動啟動僅在安裝版中可用",
	invalidArgument: "參數無效",
	previewWindowTitle: "NewPath 編輯",
	pinWindowTitle: "NewPath 釘圖",
	captureFailedTitle: "無法截圖",
	captureFailedMacPermission: "請在「系統設定 → 隱私權與安全性 → 螢幕錄製」中允許 NewPath，然後重新啟動 App。",
	captureFailedRetry: "無法取得螢幕畫面，請再試一次。",
	saveFailedTitle: "儲存失敗",
	saveFailedMessage: (dir: string, error: string) => `無法寫入 ${dir}\n${error}`,
	pngFilterName: "PNG 圖片",
	chooseSaveDirTitle: "選擇截圖儲存位置",
	notifySaved: "截圖已儲存",
	notifySavedPathCopied: "截圖已儲存，路徑已複製",
	screenshotFilePrefix: "截圖",
	invalidFileName: "檔案名稱無效",
	fileNotFound: "檔案已不存在",
	operationFailed: (code: string) => `操作失敗（${code}）`,
	invalidImageData: "圖片資料無效",
	cannotReadImage: "無法讀取圖片",
	fileNameExists: (name: string) => `已有同名檔案 ${name}`,
	fileNameEmpty: "檔案名稱不能空白",
	fileNameInvalidChars: '檔案名稱不能包含 \\ / : * ? " < > |',
	fileNameTrailing: "檔案名稱不能以空格或句點結尾",
	fileNameReserved: "這是系統保留的檔案名稱",
	fileNameTooLong: "檔案名稱太長",
	invalidShortcut: "快速鍵無效",
	shortcutUnavailable: (accelerator: string) => `${accelerator} 無法使用，可能已被其他程式佔用`,
	ocrUnsupported: "目前的系統尚不支援文字辨識",
	ocrNoLanguage: "系統沒有可用的文字辨識語言，請在「設定 → 時間與語言 → 語言與地區」中新增中文或英文語言套件",
	ocrFailed: "文字辨識失敗",
	ocrFailedRetry: "文字辨識失敗，請再試一次",
};

const en: MainMessages = {
	trayTooltip: "NewPath Screenshot",
	trayOpenMain: "Open NewPath",
	trayCapture: "Take Screenshot",
	trayCaptureNoShortcut: "Take Screenshot (shortcut unavailable)",
	trayCloseAllPins: "Close All Pins",
	trayQuit: "Quit",
	openAtLoginUnsupported: "Launch at login is only available in the installed app",
	invalidArgument: "Invalid argument",
	previewWindowTitle: "NewPath Editor",
	pinWindowTitle: "NewPath Pin",
	captureFailedTitle: "Can't take screenshot",
	captureFailedMacPermission: "Allow NewPath in System Settings → Privacy & Security → Screen Recording, then restart the app.",
	captureFailedRetry: "Couldn't capture the screen. Please try again.",
	saveFailedTitle: "Couldn't save",
	saveFailedMessage: (dir: string, error: string) => `Can't write to ${dir}\n${error}`,
	pngFilterName: "PNG image",
	chooseSaveDirTitle: "Choose where to save screenshots",
	notifySaved: "Screenshot saved",
	notifySavedPathCopied: "Screenshot saved, path copied",
	screenshotFilePrefix: "Screenshot",
	invalidFileName: "Invalid file name",
	fileNotFound: "File no longer exists",
	operationFailed: (code: string) => `Operation failed (${code})`,
	invalidImageData: "Invalid image data",
	cannotReadImage: "Can't read the image",
	fileNameExists: (name: string) => `A file named ${name} already exists`,
	fileNameEmpty: "File name can't be empty",
	fileNameInvalidChars: "File name can't contain \\ / : * ? \" < > |",
	fileNameTrailing: "File name can't end with a space or period",
	fileNameReserved: "This file name is reserved by the system",
	fileNameTooLong: "File name is too long",
	invalidShortcut: "Invalid shortcut",
	shortcutUnavailable: (accelerator: string) => `${accelerator} is unavailable. It may be in use by another app.`,
	ocrUnsupported: "Text recognition isn't supported on this system",
	ocrNoLanguage: "No text recognition language is available. Add a Chinese or English language pack in Settings → Time & language → Language & region.",
	ocrFailed: "Text recognition failed",
	ocrFailedRetry: "Text recognition failed. Please try again.",
};

const MESSAGES: Record<Locale, MainMessages> = { "zh-CN": zhCN, "zh-TW": zhTW, en };

let current: Locale = "zh-CN";

export function setMainLocale(locale: Locale) {
	current = locale;
}

/** 当前语言的文案；每次用时现取，切换语言后立即生效。 */
export function mt(): MainMessages {
	return MESSAGES[current];
}
