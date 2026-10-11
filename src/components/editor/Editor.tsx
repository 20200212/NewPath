import { Check, Crop, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/ToolButton";
import { Toast, useToast } from "@/components/ui/Toast";
import { combineCrops, cropAnnotations, normalizeCrop } from "@/editor/crop";
import { buildSourceCanvas, canvasToPng, loadImage, renderDocument } from "@/editor/exportImage";
import { moveAnnotation, nextCounterValue } from "@/editor/geometry";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo, type History } from "@/editor/history";
import { commandForKey, type EditorCommand } from "@/editor/keymap";
import {
	clampUnit,
	redactStrengthFor,
	restyleAnnotation,
	sanitizeStyle,
	stepSize,
	styleFromAnnotation,
	textSizeFor,
} from "@/editor/presets";
import { describeKinds, regionsToRedactions } from "@/editor/smartRedact";
import { movePiece, remapAnnotations, stitchLayout, type StitchLayout } from "@/editor/stitch";
import { measureText } from "@/editor/textLayout";
import type { Annotation, EditorDoc, Rect, Tool, ToolStyle } from "@/editor/types";
import { useI18n } from "@/i18n";
import { createMockScreenshot } from "@/lib/mockImage";
import { OcrPanel } from "./OcrPanel";
import { Stage } from "./Stage";
import type { CommitOptions, TextEditState } from "./stageTypes";
import { StitchPanel } from "./StitchPanel";
import { StyleBar } from "./StyleBar";
import { Toolbar } from "./Toolbar";
import { isEditableTarget, useStageView } from "./useStageView";
import { ZoomBar } from "./ZoomBar";

const STYLE_STORAGE_KEY = "newpath.editor.style";
const TOOL_STORAGE_KEY = "newpath.editor.tool";
/** 钉图的最长边，太大的图片缩小后再钉。 */
const PIN_MAX_SIDE = 3072;
const TOOLS: readonly Tool[] = ["select", "rect", "ellipse", "arrow", "line", "pen", "highlighter", "text", "counter", "redact"];

const EMPTY_DOC: EditorDoc = { pieces: [], gap: 0, crop: null, annotations: [] };

interface PieceImage {
	source: CanvasImageSource;
	/** 拼接面板里的缩略图。 */
	src: string;
}

interface OcrState {
	open: boolean;
	status: "idle" | "loading" | "done" | "error";
	text: string;
	error: string | null;
	/** 识别结果对应的源图，源图变化（裁剪、拼接）后需要重新识别。 */
	sourceKey: string;
}

let idSeq = 0;
function newId() {
	return `${Date.now().toString(36)}-${++idSeq}`;
}

function loadStyle(): ToolStyle {
	try {
		return sanitizeStyle(JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) ?? "null"));
	} catch {
		return sanitizeStyle(null);
	}
}

function loadTool(): Tool {
	const saved = localStorage.getItem(TOOL_STORAGE_KEY) as Tool | null;
	return saved && TOOLS.includes(saved) ? saved : "rect";
}

/** 把正在编辑的文字合并进标注列表：空文字删除（新建的直接丢弃），否则按当前字号重新测量外框。 */
function mergeTextEdit(annotations: Annotation[], edit: TextEditState): { annotations: Annotation[]; id: string | null } {
	const empty = !edit.text.trim();
	const box = measureText(edit.text, edit.size, edit.style);
	const fields = { x: edit.x, y: edit.y, w: box.w, h: box.h, text: edit.text, color: edit.color, size: edit.size, style: edit.style };
	if (edit.id) {
		if (empty) return { annotations: annotations.filter((annotation) => annotation.id !== edit.id), id: null };
		return {
			annotations: annotations.map((annotation) =>
				annotation.id === edit.id && annotation.kind === "text" ? { ...annotation, ...fields } : annotation,
			),
			id: edit.id,
		};
	}
	if (empty) return { annotations, id: null };
	const id = newId();
	return { annotations: [...annotations, { id, kind: "text", ...fields }], id };
}

/** 编辑窗口：标注、裁剪、拼接、OCR、智能打码，以及复制 / 保存 / 钉图。 */
export function Editor() {
	const api = window.electronAPI;
	const unit = clampUnit(window.devicePixelRatio);
	const ocrSupported = api ? api.platform === "win32" || api.platform === "darwin" : true;
	const { t } = useI18n();
	const msg = t.editor;
	/** 只在挂载时运行的副作用用它取文案，切换语言不会让它们重跑。 */
	const msgRef = useRef(msg);
	msgRef.current = msg;

	const imagesRef = useRef(new Map<string, PieceImage>());
	const [imagesVersion, setImagesVersion] = useState(0);
	const [history, setHistory] = useState<History<EditorDoc>>(() => createHistory(EMPTY_DOC));
	const doc = history.present;
	const docRef = useRef(doc);
	docRef.current = doc;

	const [tool, setToolState] = useState<Tool>(loadTool);
	const [style, setStyle] = useState<ToolStyle>(loadStyle);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
	const textEditRef = useRef(textEdit);
	textEditRef.current = textEdit;
	/** 裁剪模式下的裁剪框；null 表示不在裁剪模式。 */
	const [crop, setCrop] = useState<Rect | null>(null);
	const [ocr, setOcr] = useState<OcrState>({ open: false, status: "idle", text: "", error: null, sourceKey: "" });
	const [redactBusy, setRedactBusy] = useState(false);
	const { toast, showToast } = useToast();

	// ------------------------------------------------------------ 源图（拼接 + 裁剪）

	const layout = useMemo(() => stitchLayout(doc.pieces, doc.gap), [doc.pieces, doc.gap]);
	const sourceKey = `${doc.pieces.map((piece) => piece.id).join(",")}|${doc.gap}|${
		doc.crop ? `${doc.crop.x},${doc.crop.y},${doc.crop.width},${doc.crop.height}` : "full"
	}`;
	const source = useMemo(() => {
		const images = new Map<string, CanvasImageSource>();
		for (const piece of doc.pieces) {
			const image = imagesRef.current.get(piece.id);
			if (!image) return null;
			images.set(piece.id, image.source);
		}
		return doc.pieces.length ? buildSourceCanvas(layout, images, doc.crop) : null;
		// imagesVersion：图片加载完成后重新合成
	}, [layout, doc.crop, doc.pieces, imagesVersion]);
	const sourceRef = useRef(source);
	sourceRef.current = source;
	const sourceKeyRef = useRef(sourceKey);
	sourceKeyRef.current = sourceKey;

	const imageSize = doc.crop ? { width: doc.crop.width, height: doc.crop.height } : { width: layout.width, height: layout.height };
	const view = useStageView(imageSize, unit);

	const addImage = useCallback((src: string, image: CanvasImageSource) => {
		const id = newId();
		imagesRef.current.set(id, { source: image, src });
		setImagesVersion((version) => version + 1);
		return id;
	}, []);

	// ------------------------------------------------------------ 文档提交

	const commit = useCallback((next: EditorDoc, coalesceKey?: string) => {
		docRef.current = next;
		setHistory((current) => pushHistory(current, next, { coalesceKey }));
	}, []);

	const commitAnnotations = useCallback(
		(annotations: Annotation[], options: CommitOptions = {}) => {
			commit({ ...docRef.current, annotations }, options.coalesceKey);
			if (options.select !== undefined) setSelectedId(options.select);
		},
		[commit],
	);

	/** 结束文字编辑并提交，返回提交后的标注列表（导出前调用，保证正在输入的文字也在里面）。 */
	const commitText = useCallback((): Annotation[] => {
		const edit = textEditRef.current;
		const current = docRef.current.annotations;
		if (!edit) return current;
		textEditRef.current = null;
		setTextEdit(null);
		const merged = mergeTextEdit(current, edit);
		if (merged.annotations !== current) commitAnnotations(merged.annotations, { select: merged.id });
		return merged.annotations;
	}, [commitAnnotations]);

	// 撤销后选中的标注可能已经不存在
	useEffect(() => {
		if (selectedId && !doc.annotations.some((annotation) => annotation.id === selectedId)) setSelectedId(null);
	}, [doc.annotations, selectedId]);

	// ------------------------------------------------------------ 加载图片

	useEffect(() => {
		let disposed = false;
		const load = async () => {
			const src = api ? await api.getPreviewImage() : createMockScreenshot(1280, 720);
			if (!src || disposed) return;
			const image = await loadImage(src);
			if (disposed) return;
			const id = addImage(src, image);
			setHistory(createHistory({ ...EMPTY_DOC, pieces: [{ id, width: image.naturalWidth, height: image.naturalHeight }] }));
		};
		void load().catch(() => showToast(msgRef.current.toast.loadFailed, "error"));
		return () => {
			disposed = true;
		};
	}, [api, addImage, showToast]);

	// ------------------------------------------------------------ 工具与样式

	const selected = doc.annotations.find((annotation) => annotation.id === selectedId) ?? null;
	const styleKind = textEdit ? "text" : (selected?.kind ?? (tool === "select" ? null : tool));
	const displayStyle = useMemo(
		() => (selected ? { ...style, ...styleFromAnnotation(selected, unit) } : style),
		[selected, style, unit],
	);

	const setTool = useCallback(
		(next: Tool) => {
			commitText();
			setCrop(null);
			view.setHandMode(false);
			setToolState(next);
			localStorage.setItem(TOOL_STORAGE_KEY, next);
			const current = docRef.current.annotations.find((annotation) => annotation.id === selectedId);
			if (current && next !== "select" && current.kind !== next) setSelectedId(null);
		},
		[commitText, selectedId, view],
	);

	const applyStyle = useCallback(
		(patch: Partial<ToolStyle>) => {
			const next = { ...style, ...patch };
			setStyle(next);
			localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(next));
			const edit = textEditRef.current;
			if (edit) {
				setTextEdit({
					...edit,
					color: patch.color ?? edit.color,
					size: patch.textSize === undefined ? edit.size : textSizeFor(patch.textSize, unit),
					style: patch.textStyle ?? edit.style,
				});
				return;
			}
			if (!selected) return;
			const restyled = restyleAnnotation(selected, patch, unit, measureText);
			commitAnnotations(
				docRef.current.annotations.map((annotation) => (annotation.id === selected.id ? restyled : annotation)),
				{ coalesceKey: `style:${selected.id}` },
			);
		},
		[commitAnnotations, selected, style, unit],
	);

	const deleteSelected = useCallback(() => {
		if (!selectedId) return;
		commitAnnotations(
			docRef.current.annotations.filter((annotation) => annotation.id !== selectedId),
			{ select: null },
		);
	}, [commitAnnotations, selectedId]);

	const duplicateSelected = useCallback(() => {
		if (!selected) return;
		const offset = 16 * unit;
		const copy = { ...moveAnnotation(selected, offset, offset), id: newId() };
		if (copy.kind === "counter") copy.value = nextCounterValue(docRef.current.annotations);
		commitAnnotations([...docRef.current.annotations, copy], { select: copy.id });
	}, [commitAnnotations, selected, unit]);

	const nudgeSelected = useCallback(
		(dx: number, dy: number) => {
			if (!selected) return;
			const moved = moveAnnotation(selected, dx, dy);
			commitAnnotations(
				docRef.current.annotations.map((annotation) => (annotation.id === selected.id ? moved : annotation)),
				{ coalesceKey: `nudge:${selected.id}` },
			);
		},
		[commitAnnotations, selected],
	);

	const startTextEdit = useCallback((state: TextEditState) => {
		setTextEdit(state);
		setSelectedId(state.id);
	}, []);

	const editSelectedText = useCallback(() => {
		if (selected?.kind !== "text") return;
		const { id, x, y, text, color, size, style: textStyle } = selected;
		startTextEdit({ id, x, y, text, color, size, style: textStyle });
	}, [selected, startTextEdit]);

	// ------------------------------------------------------------ 撤销 / 重做

	const historyAction = useCallback(
		(action: "undo" | "redo") => {
			if (crop) return;
			commitText();
			setHistory((current) => (action === "undo" ? undo(current) : redo(current)));
		},
		[commitText, crop],
	);

	// ------------------------------------------------------------ 裁剪

	const toggleCrop = useCallback(() => {
		if (crop) {
			setCrop(null);
			return;
		}
		commitText();
		setSelectedId(null);
		view.setHandMode(false);
		setCrop({ x: 0, y: 0, width: imageSize.width, height: imageSize.height });
	}, [commitText, crop, imageSize.height, imageSize.width, view]);

	const applyCrop = useCallback(() => {
		if (!crop) return;
		setCrop(null);
		const current = docRef.current;
		const rect = normalizeCrop(crop, imageSize);
		if (!rect) return;
		commit({ ...current, crop: combineCrops(current.crop, rect), annotations: cropAnnotations(current.annotations, rect) });
	}, [commit, crop, imageSize]);

	// ------------------------------------------------------------ 拼接

	/** 当前文档的拼接布局；裁剪过时先把裁剪结果烘焙成一张图，后面的图接在它下面。 */
	const flattenForStitch = useCallback((): { pieces: EditorDoc["pieces"]; from: StitchLayout } => {
		const current = docRef.current;
		const currentSource = sourceRef.current;
		if (!current.crop || !currentSource) {
			return { pieces: current.pieces, from: stitchLayout(current.pieces, current.gap) };
		}
		const id = addImage(currentSource.toDataURL("image/png"), currentSource);
		const piece = { id, width: currentSource.width, height: currentSource.height };
		return { pieces: [piece], from: { width: piece.width, height: piece.height, placements: [{ ...piece, x: 0, y: 0 }] } };
	}, [addImage]);

	const addPiece = useCallback(
		async (src: string) => {
			let image: HTMLImageElement;
			try {
				image = await loadImage(src);
			} catch {
				showToast(msg.toast.readFailed, "error");
				return;
			}
			commitText();
			setCrop(null);
			const id = addImage(src, image);
			const current = docRef.current;
			const { pieces: base, from } = flattenForStitch();
			const pieces = [...base, { id, width: image.naturalWidth, height: image.naturalHeight }];
			const to = stitchLayout(pieces, current.gap);
			commit({ pieces, gap: current.gap, crop: null, annotations: remapAnnotations(current.annotations, from, to) });
			showToast(msg.toast.stitched(pieces.length));
		},
		[addImage, commit, commitText, flattenForStitch, showToast, msg],
	);

	const updatePieces = useCallback(
		(pieces: EditorDoc["pieces"], gap: number, coalesceKey?: string) => {
			const current = docRef.current;
			// 拼接面板只在没有裁剪时显示，这里直接按原始图片重新排列
			const from = stitchLayout(current.pieces, current.gap);
			const to = stitchLayout(pieces, gap);
			commit({ ...current, pieces, gap, annotations: remapAnnotations(current.annotations, from, to) }, coalesceKey);
		},
		[commit],
	);

	const startStitch = useCallback(() => {
		commitText();
		if (api) void api.startStitch();
		else showToast(msg.toast.stitchDevUi);
	}, [api, commitText, showToast, msg]);

	useEffect(() => {
		if (!api) return;
		return api.onStitchAdded(() => {
			void api.takeStitchImage().then((src) => {
				if (src) void addPiece(src);
			});
		});
	}, [api, addPiece]);

	// 粘贴图片也当作拼接
	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return;
			const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
			if (!file) return;
			event.preventDefault();
			void addPiece(URL.createObjectURL(file));
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [addPiece]);

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		for (const file of [...event.dataTransfer.files]) {
			if (file.type.startsWith("image/")) void addPiece(URL.createObjectURL(file));
		}
	};

	// ------------------------------------------------------------ 导出

	const exportPng = useCallback(
		async (maxSide?: number): Promise<Uint8Array | null> => {
			const annotations = commitText();
			const currentSource = sourceRef.current;
			if (!currentSource) return null;
			return canvasToPng(renderDocument(currentSource, annotations, sourceKeyRef.current, maxSide));
		},
		[commitText],
	);

	const copy = useCallback(async () => {
		const png = await exportPng();
		if (!png) return;
		if (api) await api.copyImage(png);
		showToast(msg.toast.copied);
	}, [api, exportPng, showToast, msg]);

	const save = useCallback(
		async (as: boolean) => {
			const png = await exportPng();
			if (!png) return;
			if (!api) return showToast(msg.toast.saveDevUi, "error");
			const result = await (as ? api.saveImageAs(png) : api.saveImage(png));
			if (result.saved) showToast(msg.toast.saved(result.filePath));
		},
		[api, exportPng, showToast, msg],
	);

	const pin = useCallback(async () => {
		const png = await exportPng(PIN_MAX_SIDE);
		if (!png) return;
		if (api) await api.pinImage(png);
		showToast(msg.toast.pinned);
	}, [api, exportPng, showToast, msg]);

	// ------------------------------------------------------------ OCR 与智能打码

	const runOcr = useCallback(async () => {
		const currentSource = sourceRef.current;
		if (!currentSource) return;
		const key = sourceKeyRef.current;
		setOcr({ open: true, status: "loading", text: "", error: null, sourceKey: key });
		const result = api
			? await api.recognizeText(await canvasToPng(currentSource))
			: {
					ok: true as const,
					lines: [
						{ text: msg.ocr.devMockResult, words: [] },
						{ text: "admin@example.com", words: [] },
					],
				};
		if (sourceKeyRef.current !== key) return;
		setOcr((current) =>
			result.ok
				? { ...current, status: "done", text: result.lines.map((line) => line.text).join("\n") }
				: { ...current, status: "error", error: result.reason },
		);
	}, [api, msg]);

	const toggleOcr = useCallback(() => {
		if (!ocrSupported) return;
		if (ocr.open) {
			setOcr((current) => ({ ...current, open: false }));
			return;
		}
		if (ocr.sourceKey === sourceKey && ocr.status === "done") setOcr((current) => ({ ...current, open: true }));
		else void runOcr();
	}, [ocr.open, ocr.sourceKey, ocr.status, ocrSupported, runOcr, sourceKey]);

	const copyOcrText = useCallback(async () => {
		if (!ocr.text) return;
		if (api) await api.copyText(ocr.text);
		showToast(msg.toast.textCopied);
	}, [api, ocr.text, showToast, msg]);

	const smartRedact = useCallback(async () => {
		const currentSource = sourceRef.current;
		if (!currentSource || redactBusy || !ocrSupported) return;
		commitText();
		if (tool !== "redact") setTool("redact");
		const key = sourceKeyRef.current;
		setRedactBusy(true);
		const result = api
			? await api.findSensitiveRegions(await canvasToPng(currentSource))
			: { ok: true as const, regions: [{ x: 40, y: 40, width: 220, height: 32, kind: "email" as const }] };
		setRedactBusy(false);
		if (sourceKeyRef.current !== key) return;
		if (!result.ok) return showToast(result.reason, "error");
		const strength = redactStrengthFor(style.redactMode, style.strokeSize, unit);
		const added = regionsToRedactions(result.regions, docRef.current.annotations, style.redactMode, strength, newId);
		if (!added.length) {
			showToast(result.regions.length ? msg.toast.alreadyRedacted : msg.toast.nothingToRedact);
			return;
		}
		commitAnnotations([...docRef.current.annotations, ...added], { select: null });
		showToast(msg.toast.redacted(added.length, describeKinds(result.regions, msg.sensitiveKinds, msg.kindSeparator)));
	}, [api, commitAnnotations, commitText, ocrSupported, redactBusy, setTool, showToast, style, msg, tool, unit]);

	// ------------------------------------------------------------ 键盘

	const runCommand = useCallback(
		(command: EditorCommand) => {
			switch (command.type) {
				case "tool":
					return setTool(command.tool);
				case "crop":
					return toggleCrop();
				case "undo":
				case "redo":
					return historyAction(command.type);
				case "copy":
					return void copy();
				case "save":
					return void save(false);
				case "save-as":
					return void save(true);
				case "pin":
					return void pin();
				case "ocr":
					return toggleOcr();
				case "smart-redact":
					return void smartRedact();
				case "stitch":
					return startStitch();
				case "duplicate":
					return duplicateSelected();
				case "zoom-in":
					return view.zoomIn();
				case "zoom-out":
					return view.zoomOut();
				case "zoom-actual":
					return view.actualSize();
				case "zoom-fit":
					return view.fit();
			}
		},
		[copy, duplicateSelected, historyAction, pin, save, setTool, smartRedact, startStitch, toggleCrop, toggleOcr, view],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || isEditableTarget(event.target)) return;
			const mod = event.ctrlKey || event.metaKey;
			if (event.key === "Escape") {
				// 逐级退出：裁剪 → OCR 面板 → 取消选中 → 关闭窗口
				if (crop) setCrop(null);
				else if (ocr.open) setOcr((current) => ({ ...current, open: false }));
				else if (selectedId) setSelectedId(null);
				else void api?.closeWindow();
				return;
			}
			if (event.key === "Enter" && !mod) {
				if (crop) applyCrop();
				else editSelectedText();
				return;
			}
			if (mod && event.key.toLowerCase() === "w") {
				event.preventDefault();
				void api?.closeWindow();
				return;
			}
			const command = commandForKey(event);
			if (crop) {
				// 裁剪时只响应裁剪和缩放
				if (command && (command.type === "crop" || command.type.startsWith("zoom-"))) {
					event.preventDefault();
					runCommand(command);
				}
				return;
			}
			if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
				event.preventDefault();
				deleteSelected();
				return;
			}
			const arrows: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
			};
			if (arrows[event.key] && selectedId) {
				event.preventDefault();
				const step = (event.shiftKey ? 10 : 1) * unit;
				nudgeSelected(arrows[event.key][0] * step, arrows[event.key][1] * step);
				return;
			}
			if ((event.key === "[" || event.key === "]") && !mod && styleKind) {
				applyStyle(stepSize(displayStyle, styleKind, event.key === "]" ? 1 : -1));
				return;
			}
			if (!command) return;
			event.preventDefault();
			runCommand(command);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		api,
		applyCrop,
		applyStyle,
		crop,
		deleteSelected,
		displayStyle,
		editSelectedText,
		nudgeSelected,
		ocr.open,
		runCommand,
		selectedId,
		styleKind,
		unit,
	]);

	// ------------------------------------------------------------ 界面

	const stitchPieces = doc.pieces.map((piece) => ({ ...piece, src: imagesRef.current.get(piece.id)?.src ?? "" }));
	const showStitch = doc.pieces.length > 1 && !doc.crop;
	const showStyleBar = !crop && styleKind !== null;

	return (
		<div
			className="flex h-screen select-none flex-col overflow-hidden bg-apple-bg"
			onDragOver={(event) => event.preventDefault()}
			onDrop={onDrop}
		>
			<Toolbar
				tool={tool}
				cropping={crop !== null}
				canUndo={!crop && canUndo(history)}
				canRedo={!crop && canRedo(history)}
				ocrSupported={ocrSupported}
				ocrOpen={ocr.open}
				onUndo={() => historyAction("undo")}
				onRedo={() => historyAction("redo")}
				onTool={setTool}
				onCrop={toggleCrop}
				onStitch={startStitch}
				onOcr={toggleOcr}
				onPin={() => void pin()}
				onSaveAs={() => void save(true)}
				onSave={() => void save(false)}
				onCopy={() => void copy()}
				onMinimize={() => void api?.minimizeWindow()}
				onMaximize={() => void api?.toggleMaximizeWindow()}
				onClose={() => void api?.closeWindow()}
			/>

			<div className="flex min-h-0 flex-1">
				<main className="relative min-w-0 flex-1">
					<Stage
						view={view}
						source={source}
						sourceKey={sourceKey}
						imageSize={imageSize}
						annotations={doc.annotations}
						tool={tool}
						style={style}
						unit={unit}
						selectedId={selectedId}
						onSelect={setSelectedId}
						onCommit={commitAnnotations}
						textEdit={textEdit}
						onStartText={startTextEdit}
						onTextChange={(text) => setTextEdit((current) => (current ? { ...current, text } : current))}
						onTextCommit={() => void commitText()}
						crop={crop}
						onCropChange={setCrop}
						onCropConfirm={applyCrop}
					/>

					{showStyleBar && styleKind && (
						<div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
							<StyleBar
								kind={styleKind}
								style={displayStyle}
								onChange={applyStyle}
								hasSelection={selected !== null && !textEdit}
								onDuplicate={duplicateSelected}
								onDelete={deleteSelected}
								smartRedactAvailable={ocrSupported}
								smartRedactBusy={redactBusy}
								onSmartRedact={() => void smartRedact()}
							/>
						</div>
					)}

					{crop && (
						<div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
							<div
								data-no-wheel
								className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/95 py-1.5 pl-4 pr-1.5 shadow-card backdrop-blur-xl"
							>
								<Crop size={16} strokeWidth={2.5} className="text-apple-blue" />
								<span className="whitespace-nowrap text-xs font-bold text-gray-500">{msg.crop.hint}</span>
								<span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs font-bold text-gray-600">
									{Math.round(crop.width)} × {Math.round(crop.height)}
								</span>
								<ChipButton className="whitespace-nowrap" onClick={() => setCrop(null)}>
									<X size={14} strokeWidth={2.5} />
									{msg.crop.cancel}
								</ChipButton>
								<Button size="sm" className="whitespace-nowrap" onClick={applyCrop}>
									<Check size={16} strokeWidth={2.5} />
									{msg.crop.confirm}
								</Button>
							</div>
						</div>
					)}

					<div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
						<ZoomBar
							width={imageSize.width}
							height={imageSize.height}
							zoom={view.zoom}
							fitting={view.fitting}
							handMode={view.handMode}
							onZoomIn={view.zoomIn}
							onZoomOut={view.zoomOut}
							onSetZoom={(zoom) => view.setZoom(zoom)}
							onActualSize={view.actualSize}
							onFit={view.fit}
							onToggleHand={() => view.setHandMode(!view.handMode)}
						/>
					</div>
				</main>

				{(showStitch || ocr.open) && (
					<div className="flex min-h-0 shrink-0 flex-col">
						{showStitch && (
							<StitchPanel
								pieces={stitchPieces}
								gap={doc.gap}
								onMove={(index, delta) => updatePieces(movePiece(doc.pieces, index, delta), doc.gap)}
								onRemove={(index) =>
									updatePieces(
										doc.pieces.filter((_, i) => i !== index),
										doc.gap,
									)
								}
								onGapChange={(gap) => updatePieces(doc.pieces, gap, "stitch-gap")}
								onAdd={startStitch}
							/>
						)}
						{ocr.open && (
							<OcrPanel
								status={ocr.status}
								text={ocr.text}
								error={ocr.error}
								onTextChange={(text) => setOcr((current) => ({ ...current, text }))}
								onRetry={() => void runOcr()}
								onCopy={() => void copyOcrText()}
								onClose={() => setOcr((current) => ({ ...current, open: false }))}
							/>
						)}
					</div>
				)}
			</div>
			<Toast toast={toast} />
		</div>
	);
}
