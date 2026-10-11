import type { Rect } from "../../electron/ipcTypes";

export type { Rect };

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export type ShapeFill = "none" | "soft" | "solid";
export type TextStyle = "plain" | "pill" | "outline";
export type RedactMode = "pixelate" | "blur";
/** 三档粗细：小 / 中 / 大。 */
export type SizeLevel = 0 | 1 | 2;
/** 四档字号。 */
export type TextSizeLevel = 0 | 1 | 2 | 3;

interface AnnotationBase {
	id: string;
}

/** 以下坐标全部是源图像素（拼接、裁剪之后的图）。 */
export interface BoxAnnotation extends AnnotationBase {
	kind: "rect" | "ellipse";
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	width: number;
	fill: ShapeFill;
}

export interface LineAnnotation extends AnnotationBase {
	kind: "arrow" | "line";
	from: Point;
	to: Point;
	color: string;
	width: number;
}

export interface PathAnnotation extends AnnotationBase {
	kind: "pen" | "highlighter";
	points: Point[];
	color: string;
	width: number;
}

/** x / y / w / h 是含内边距的外框，w / h 在创建或改字号时测量得到。 */
export interface TextAnnotation extends AnnotationBase {
	kind: "text";
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
	color: string;
	size: number;
	style: TextStyle;
}

/** x / y 是圆心，size 是半径。 */
export interface CounterAnnotation extends AnnotationBase {
	kind: "counter";
	x: number;
	y: number;
	value: number;
	color: string;
	size: number;
}

/** strength：像素化的块大小，或模糊半径。 */
export interface RedactAnnotation extends AnnotationBase {
	kind: "redact";
	x: number;
	y: number;
	w: number;
	h: number;
	mode: RedactMode;
	strength: number;
}

export type Annotation =
	| BoxAnnotation
	| LineAnnotation
	| PathAnnotation
	| TextAnnotation
	| CounterAnnotation
	| RedactAnnotation;

export type AnnotationKind = Annotation["kind"];
export type Tool = "select" | AnnotationKind;

/** 拼接的一张图；像素数据由编辑器按 id 另外保存，不进撤销历史。 */
export interface StitchPiece {
	id: string;
	width: number;
	height: number;
}

/** 编辑器文档：撤销 / 重做的单位。 */
export interface EditorDoc {
	pieces: StitchPiece[];
	/** 拼接时图片之间的间距（像素）。 */
	gap: number;
	/** 相对于拼接后整图的裁剪区域；null 表示不裁剪。 */
	crop: Rect | null;
	annotations: Annotation[];
}

/** 工具的当前样式，选中标注时编辑的是标注自己的样式。 */
export interface ToolStyle {
	color: string;
	strokeSize: SizeLevel;
	fill: ShapeFill;
	textSize: TextSizeLevel;
	textStyle: TextStyle;
	redactMode: RedactMode;
}
