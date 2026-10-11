import Foundation
import ImageIO
import Vision

// newpath-ocr <图片路径>...
// 用系统自带的 Vision 框架依次识别每张图片，输出一行 JSON：
// {"pages":[{"lines":[{"words":[{"text","x","y","w","h"}]}]}]}
// 每张图片对应一页，坐标是该图片的像素、原点在左上角。格式与 Windows 上 PowerShell 识别脚本的输出一致，
// 由 electron/ocrResult.ts 的 parseOcrOutput 统一解析。

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

func loadImage(_ path: String) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

/// 优先中文（简、繁）和英文；中文模型同样能识别夹在中文里的英文和数字。
func recognitionLanguages(for request: VNRecognizeTextRequest) -> [String] {
    let wanted = ["zh-Hans", "zh-Hant", "en-US"]
    guard let supported = try? request.supportedRecognitionLanguages() else { return ["en-US"] }
    let languages = wanted.filter { supported.contains($0) }
    return languages.isEmpty ? supported : languages
}

struct Line {
    let top: Double
    let left: Double
    let words: [[String: Any]]
}

func recognize(_ image: CGImage) throws -> [[String: Any]] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // 邮箱、密钥、路径这类内容不是词典里的词：关掉语言校正，按屏幕上的样子输出，智能打码才认得出来
    request.usesLanguageCorrection = false
    request.recognitionLanguages = recognitionLanguages(for: request)
    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])

    let width = Double(image.width)
    let height = Double(image.height)
    var lines: [Line] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string
        // 按空白拆成词，每个词单独取框；中文之间没有空格，一段连续的中文就是一个"词"
        var words: [[String: Any]] = []
        var index = text.startIndex
        while let start = text[index...].firstIndex(where: { !$0.isWhitespace }) {
            let end = text[start...].firstIndex(where: { $0.isWhitespace }) ?? text.endIndex
            // Vision 的框是归一化坐标，原点在左下角
            let box = (try? candidate.boundingBox(for: start..<end))?.boundingBox ?? observation.boundingBox
            words.append([
                "text": String(text[start..<end]),
                "x": box.minX * width,
                "y": (1 - box.maxY) * height,
                "w": box.width * width,
                "h": box.height * height,
            ])
            index = end
        }
        if words.isEmpty { continue }
        let box = observation.boundingBox
        lines.append(Line(top: (1 - box.maxY) * height, left: box.minX * width, words: words))
    }
    // Vision 不保证结果的顺序：按从上到下、从左到右排好，和 Windows OCR 的阅读顺序一致
    lines.sort { $0.top != $1.top ? $0.top < $1.top : $0.left < $1.left }
    return lines.map { ["words": $0.words] }
}

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty { fail("用法：newpath-ocr <图片路径>...", code: 2) }

var pages: [[String: Any]] = []
for path in paths {
    guard let image = loadImage(path) else { fail("无法读取图片：\(path)", code: 3) }
    do {
        pages.append(["lines": try recognize(image)])
    } catch {
        fail("文字识别失败：\(error.localizedDescription)", code: 4)
    }
}

guard let data = try? JSONSerialization.data(withJSONObject: ["pages": pages]) else {
    fail("无法输出识别结果", code: 5)
}
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
