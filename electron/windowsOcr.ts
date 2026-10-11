import { mt } from "./i18n";
import type { OcrEngine } from "./ocr";
import { pickOcrScale } from "./ocrResult";
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

/** Windows 自带的 Windows.Media.Ocr：小图先放大（文字越大越准），长图按 4000 像素切块。 */
export const windowsOcrEngine: OcrEngine = {
	scale: (size) => pickOcrScale(size),
	tileHeight: 4000,
	run: (files) => runPowerShell(ocrScript(files), OCR_TIMEOUT_MS),
	errorReason: (code) => (code === "no-engine" ? mt().ocrNoLanguage : mt().ocrFailed),
};
