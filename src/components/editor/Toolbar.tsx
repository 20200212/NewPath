import {
	Circle,
	Copy,
	Crop,
	Download,
	FolderDown,
	Grid3x3,
	Highlighter,
	ImagePlus,
	ListOrdered,
	Minus,
	MousePointer2,
	MoveUpRight,
	Pencil,
	Pin,
	Redo2,
	ScanText,
	Square,
	Type,
	Undo2,
	type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ToolButton, ToolGroup } from "@/components/ui/ToolButton";
import { WindowControls } from "@/components/ui/WindowControls";
import { TOOL_KEYS } from "@/editor/keymap";
import type { Tool } from "@/editor/types";

const TOOLS: { id: Tool; icon: LucideIcon; label: string }[] = [
	{ id: "select", icon: MousePointer2, label: "选择" },
	{ id: "rect", icon: Square, label: "矩形" },
	{ id: "ellipse", icon: Circle, label: "椭圆" },
	{ id: "arrow", icon: MoveUpRight, label: "箭头" },
	{ id: "line", icon: Minus, label: "直线" },
	{ id: "pen", icon: Pencil, label: "画笔" },
	{ id: "highlighter", icon: Highlighter, label: "荧光笔" },
	{ id: "text", icon: Type, label: "文字" },
	{ id: "counter", icon: ListOrdered, label: "序号" },
	{ id: "redact", icon: Grid3x3, label: "马赛克" },
];

interface ToolbarProps {
	tool: Tool;
	cropping: boolean;
	canUndo: boolean;
	canRedo: boolean;
	ocrSupported: boolean;
	ocrOpen: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onTool: (tool: Tool) => void;
	onCrop: () => void;
	onStitch: () => void;
	onOcr: () => void;
	onPin: () => void;
	onSaveAs: () => void;
	onSave: () => void;
	onCopy: () => void;
	onMinimize: () => void;
	onMaximize: () => void;
	onClose: () => void;
}

/** 编辑窗口的标题栏：撤销重做、标注工具、裁剪，右侧是输出操作和窗口按钮。 */
export function Toolbar(props: ToolbarProps) {
	const { tool, cropping } = props;
	return (
		<header className="drag flex h-14 shrink-0 items-center gap-2 border-b border-gray-200/60 bg-white/70 px-3 backdrop-blur-xl">
			<ToolGroup>
				<ToolButton icon={Undo2} label="撤销" shortcut="Ctrl+Z" disabled={!props.canUndo} onClick={props.onUndo} />
				<ToolButton icon={Redo2} label="重做" shortcut="Ctrl+Y" disabled={!props.canRedo} onClick={props.onRedo} />
			</ToolGroup>

			<ToolGroup>
				{TOOLS.map((item) => (
					<ToolButton
						key={item.id}
						icon={item.icon}
						label={item.label}
						shortcut={TOOL_KEYS[item.id]}
						active={!cropping && tool === item.id}
						onClick={() => props.onTool(item.id)}
					/>
				))}
			</ToolGroup>

			<ToolGroup>
				<ToolButton icon={Crop} label="裁剪" shortcut="C" active={cropping} onClick={props.onCrop} />
			</ToolGroup>

			{/* 中间空白处用来拖动窗口 */}
			<div className="min-w-4 flex-1 self-stretch" />

			<ToolGroup>
				<ToolButton icon={ImagePlus} label="拼接：再截一张" shortcut="Ctrl+Shift+A" onClick={props.onStitch} />
				{props.ocrSupported && (
					<ToolButton icon={ScanText} label="提取文字" shortcut="Ctrl+Shift+T" active={props.ocrOpen} onClick={props.onOcr} />
				)}
				<ToolButton icon={Pin} label="钉到桌面" shortcut="Ctrl+Shift+P" onClick={props.onPin} />
				<ToolButton icon={FolderDown} label="另存为" shortcut="Ctrl+Shift+S" onClick={props.onSaveAs} />
				<ToolButton icon={Download} label="保存到截图库" shortcut="Ctrl+S" onClick={props.onSave} />
			</ToolGroup>

			<Button size="sm" title="复制图片（Ctrl+C）" onClick={props.onCopy}>
				<Copy size={16} strokeWidth={2.5} />
				复制
			</Button>

			<div className="h-7 w-px shrink-0 bg-gray-200" />
			<WindowControls onMinimize={props.onMinimize} onMaximize={props.onMaximize} onClose={props.onClose} />
		</header>
	);
}
