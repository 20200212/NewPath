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
import { useI18n } from "@/i18n";

const TOOLS: { id: Tool; icon: LucideIcon }[] = [
	{ id: "select", icon: MousePointer2 },
	{ id: "rect", icon: Square },
	{ id: "ellipse", icon: Circle },
	{ id: "arrow", icon: MoveUpRight },
	{ id: "line", icon: Minus },
	{ id: "pen", icon: Pencil },
	{ id: "highlighter", icon: Highlighter },
	{ id: "text", icon: Type },
	{ id: "counter", icon: ListOrdered },
	{ id: "redact", icon: Grid3x3 },
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
	const { t } = useI18n();
	const text = t.editor.toolbar;
	return (
		<header className="drag flex h-14 shrink-0 items-center gap-2 border-b border-gray-200/60 bg-white/70 px-3 backdrop-blur-xl">
			<ToolGroup>
				<ToolButton icon={Undo2} label={text.undo} shortcut="Ctrl+Z" disabled={!props.canUndo} onClick={props.onUndo} />
				<ToolButton icon={Redo2} label={text.redo} shortcut="Ctrl+Y" disabled={!props.canRedo} onClick={props.onRedo} />
			</ToolGroup>

			<ToolGroup>
				{TOOLS.map((item) => (
					<ToolButton
						key={item.id}
						icon={item.icon}
						label={t.editor.tools[item.id]}
						shortcut={TOOL_KEYS[item.id]}
						active={!cropping && tool === item.id}
						onClick={() => props.onTool(item.id)}
					/>
				))}
			</ToolGroup>

			<ToolGroup>
				<ToolButton icon={Crop} label={text.crop} shortcut="C" active={cropping} onClick={props.onCrop} />
			</ToolGroup>

			{/* 中间空白处用来拖动窗口 */}
			<div className="min-w-4 flex-1 self-stretch" />

			<ToolGroup>
				<ToolButton icon={ImagePlus} label={text.stitch} shortcut="Ctrl+Shift+A" onClick={props.onStitch} />
				{props.ocrSupported && (
					<ToolButton icon={ScanText} label={text.ocr} shortcut="Ctrl+Shift+T" active={props.ocrOpen} onClick={props.onOcr} />
				)}
				<ToolButton icon={Pin} label={text.pin} shortcut="Ctrl+Shift+P" onClick={props.onPin} />
				<ToolButton icon={FolderDown} label={text.saveAs} shortcut="Ctrl+Shift+S" onClick={props.onSaveAs} />
				<ToolButton icon={Download} label={text.save} shortcut="Ctrl+S" onClick={props.onSave} />
			</ToolGroup>

			<Button size="sm" title={text.copyTitle} className="whitespace-nowrap" onClick={props.onCopy}>
				<Copy size={16} strokeWidth={2.5} />
				{text.copy}
			</Button>

			<div className="h-7 w-px shrink-0 bg-gray-200" />
			<WindowControls onMinimize={props.onMinimize} onMaximize={props.onMaximize} onClose={props.onClose} />
		</header>
	);
}
