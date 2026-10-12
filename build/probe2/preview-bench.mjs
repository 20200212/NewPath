// 预览合成在宽选区上的耗时
import { composePreview } from "../../electron/scrollPreview.ts";
const width = 1920;
const rows = 3000;
const pixels = new Uint8Array(width * rows * 4);
for (let i = 0; i < pixels.length; i += 4) { pixels[i] = (i / 4) % 251; pixels[i + 1] = (i / 7) % 241; pixels[i + 2] = (i / 11) % 239; pixels[i + 3] = 255; }
const segs = [{ pixels, rows }];
composePreview(segs, width);
const t = performance.now();
for (let i = 0; i < 5; i++) composePreview(segs, width);
console.log("composePreview 1920 宽：", ((performance.now() - t) / 5).toFixed(1), "ms");
