import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nativeImage } from "electron";
import { mt } from "./i18n";
import type { OcrResult } from "./ipcTypes";
import { parseOcrOutput, pickOcrScale, planOcrTiles } from "./ocrResult";
import { quotePowerShell, runPowerShell } from "./powershell";

const OCR_TIMEOUT_MS = 30_000;

/**
 * 调用系统自带的 Windows.Media.Ocr（WinRT）识别一组 PNG 文件。
 * PowerShell 5.1 不能直接 await WinRT 的异步操作，借助 WindowsRuntimeSystemExtensions.AsTask 转成 Task 再等待。
 */
function ocrScript(files: string[]) {
	return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
	$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1

function Wait-WinRT($operation, [Type]$resultType) {
	$task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
	try { $null = $task.Wait(-1) } catch { throw $_.Exception.InnerException.InnerException }
	return $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
	[Console]::Out.Write('{"error":"no-engine"}')
	exit 0
}

$pages = @()
foreach ($file in @(${files.map(quotePowerShell).join(", ")})) {
	$storage = Wait-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
	$stream = Wait-WinRT ($storage.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
	$decoder = Wait-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
	$bitmap = Wait-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
	if ($bitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8) {
		$bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)
	}
	$result = Wait-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
	$lines = @()
	foreach ($line in $result.Lines) {
		$words = @()
		foreach ($word in $line.Words) {
			$box = $word.BoundingRect
			$words += @{ text = $word.Text; x = $box.X; y = $box.Y; w = $box.Width; h = $box.Height }
		}
		$lines += @{ words = $words }
	}
	$pages += @{ lines = $lines }
	$bitmap.Dispose()
	$stream.Dispose()
}
[Console]::Out.Write((ConvertTo-Json -InputObject @{ pages = $pages } -Depth 6 -Compress))
`;
}

/** 识别 PNG 里的文字。小图先放大、长图纵向切块，结果坐标都换算回原图像素。 */
export async function recognizeWithWindowsOcr(png: Buffer): Promise<OcrResult> {
	const image = nativeImage.createFromBuffer(png);
	if (image.isEmpty()) return { ok: false, reason: mt().cannotReadImage };
	const size = image.getSize();
	const scale = pickOcrScale(size);
	const scaled =
		scale === 1
			? image
			: image.resize({
					width: Math.max(1, Math.round(size.width * scale)),
					height: Math.max(1, Math.round(size.height * scale)),
					quality: "best",
				});
	const scaledSize = scaled.getSize();
	const tiles = planOcrTiles(scaledSize.height);

	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "newpath-ocr-"));
	try {
		const files = await Promise.all(
			tiles.map(async (tile, index) => {
				const file = path.join(dir, `tile-${index}.png`);
				const piece = scaled.crop({ x: 0, y: tile.offsetY, width: scaledSize.width, height: tile.height });
				await fs.writeFile(file, piece.toPNG());
				return file;
			}),
		);
		const output = await runPowerShell(ocrScript(files), OCR_TIMEOUT_MS);
		const parsed = parseOcrOutput(output, tiles, scale);
		if (parsed.ok) return parsed;
		if (parsed.error === "no-engine") {
			return { ok: false, reason: mt().ocrNoLanguage };
		}
		return { ok: false, reason: mt().ocrFailed };
	} catch (error) {
		console.warn("OCR 失败", error);
		return { ok: false, reason: mt().ocrFailedRetry };
	} finally {
		void fs.rm(dir, { recursive: true, force: true });
	}
}
