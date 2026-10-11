/** 加载图片并等待解码完成。 */
export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("图片加载失败"));
		image.src = src;
	});
}

/**
 * 按原始分辨率导出 PNG。
 * 之后的标注、背景美化都在这里画到同一块 canvas 上再导出。
 */
export async function exportPng(src: string): Promise<Uint8Array> {
	const image = await loadImage(src);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	canvas.getContext("2d")!.drawImage(image, 0, 0);

	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出失败"))), "image/png"),
	);
	return new Uint8Array(await blob.arrayBuffer());
}
