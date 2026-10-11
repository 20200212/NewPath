import type { Annotation, Rect, Size, TextStyle, Tool, ToolStyle } from "@/editor/types";
import type { StageView } from "./useStageView";

/** 正在编辑的文字。id 为 null 表示新建；x / y 是外框左上角（源图像素）。 */
export interface TextEditState {
	id: string | null;
	x: number;
	y: number;
	text: string;
	color: string;
	size: number;
	style: TextStyle;
}

export interface CommitOptions {
	/** 同一个键在短时间内的连续提交合并成一步撤销。 */
	coalesceKey?: string;
	/** 提交后选中这个标注；undefined 表示不改变选中。 */
	select?: string | null;
}

export interface StageProps {
	view: StageView;
	/** 拼接、裁剪后的源图；还没加载好时为 null。 */
	source: HTMLCanvasElement | null;
	sourceKey: string;
	imageSize: Size;
	annotations: Annotation[];
	tool: Tool;
	style: ToolStyle;
	/** 截图的缩放比例（1–4），工具尺寸要乘上它。 */
	unit: number;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	/** 用新的标注列表替换文档里的列表。 */
	onCommit: (annotations: Annotation[], options?: CommitOptions) => void;
	textEdit: TextEditState | null;
	onStartText: (state: TextEditState) => void;
	onTextChange: (text: string) => void;
	/** 结束文字编辑并提交（空文字会被丢弃）。 */
	onTextCommit: () => void;
	/** 裁剪模式下的裁剪框（源图像素）；null 表示不在裁剪模式。 */
	crop: Rect | null;
	onCropChange: (rect: Rect) => void;
	onCropConfirm: () => void;
}
