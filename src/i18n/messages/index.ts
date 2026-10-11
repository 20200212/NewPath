import type { Locale } from "../../../electron/ipcTypes";
import { capture } from "./capture";
import { common } from "./common";
import { editor } from "./editor";
import { main } from "./main";

/** 按界面分区；每个分区文件里三种语言放在一起，缺 key 时类型检查不过。 */
export function getMessages(locale: Locale) {
	return {
		common: common[locale],
		main: main[locale],
		editor: editor[locale],
		capture: capture[locale],
	};
}

export type Messages = ReturnType<typeof getMessages>;
