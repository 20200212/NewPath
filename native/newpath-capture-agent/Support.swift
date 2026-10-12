import CoreGraphics
import Foundation
import ImageIO

// 截图进程的公共部分：按行输出 JSON、错误码、写图片文件。

/// 所有回复和事件都经这条串行队列写到 stdout，保证每行是一个完整的 JSON。
private let outputQueue = DispatchQueue(label: "newpath.capture-agent.output")

func send(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object)
    else { return }
    outputQueue.async {
        let line = data + Data([0x0A])
        line.withUnsafeBytes { buffer in
            var written = 0
            while written < buffer.count {
                let result = Darwin.write(STDOUT_FILENO, buffer.baseAddress! + written, buffer.count - written)
                if result > 0 {
                    written += result
                } else if result < 0 && errno == EINTR {
                    continue
                } else {
                    // Electron 那一端已经关了，没人再读
                    exit(0)
                }
            }
        }
    }
}

/// 等已经排队的输出都写完。
func flushOutput() {
    outputQueue.sync {}
}

/// 成功的回复：{"id","ok":true,...}
func reply(_ id: Int, _ fields: [String: Any] = [:]) {
    var object = fields
    object["id"] = id
    object["ok"] = true
    send(object)
}

/// 失败的回复：{"id","ok":false,"error":错误码,"detail":系统给的说明（可选）}
func fail(_ id: Int, _ code: String, detail: String? = nil) {
    var object: [String: Any] = ["id": id, "ok": false, "error": code]
    if let detail { object["detail"] = detail }
    send(object)
}

/// 错误码，Electron 按它决定怎么处理。
enum AgentError {
    static let badRequest = "bad-request"
    static let unknownCommand = "unknown-command"
    /// 系统版本太老：截图类命令要 macOS 14，滚动截图要 macOS 12.3。
    static let unsupported = "unsupported"
    static let noPermission = "no-permission"
    static let displayNotFound = "display-not-found"
    static let windowNotFound = "window-not-found"
    static let captureFailed = "capture-failed"
    static let noFrame = "no-frame"
    static let badRect = "bad-rect"
    static let emptyImage = "empty-image"
    static let writeFailed = "write-failed"
    static let notRunning = "not-running"
    static let noWindow = "no-window"
    static let noScroll = "no-scroll"
    static let noFrames = "no-frames"
    static let cancelled = "cancelled"
    static let fixtureUnreadable = "fixture-unreadable"
}

/// 把 JSON 里的数字取成 Int（只接受整数）。
func intValue(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded() == double, abs(double) < 1e15 else { return nil }
    return Int(double)
}

/// 把 JSON 里的数字取成 Double。
func doubleValue(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return number.doubleValue.isFinite ? number.doubleValue : nil
}

/// {"x","y","width","height"} → CGRect；宽高必须大于 0。
func rectValue(_ value: Any?) -> CGRect? {
    guard
        let object = value as? [String: Any],
        let x = doubleValue(object["x"]), let y = doubleValue(object["y"]),
        let width = doubleValue(object["width"]), let height = doubleValue(object["height"]),
        width > 0, height > 0
    else { return nil }
    return CGRect(x: x, y: y, width: width, height: height)
}

/// 请求里的文件路径：必须是绝对路径，扩展名在允许的范围内（不区分大小写）。
func pathValue(_ value: Any?, extensions: [String]) -> String? {
    guard let path = value as? String, path.hasPrefix("/") else { return nil }
    let lowercased = path.lowercased()
    return extensions.contains(where: { lowercased.hasSuffix($0) }) ? path : nil
}

private func isJPEGPath(_ path: String) -> Bool {
    let lowercased = path.lowercased()
    return lowercased.hasSuffix(".jpg") || lowercased.hasSuffix(".jpeg")
}

/// 按扩展名写成 PNG 或 JPEG。先写到同目录的临时文件再改名，读的一方不会读到写了一半的文件。
func writeImage(_ image: CGImage, to path: String, jpegQuality: Double = 0.92) -> Bool {
    let jpeg = isJPEGPath(path)
    let temporary = "\(path).\(getpid()).part"
    guard let destination = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: temporary) as CFURL, (jpeg ? "public.jpeg" : "public.png") as CFString, 1, nil)
    else { return false }
    let options: [CFString: Any] = jpeg ? [kCGImageDestinationLossyCompressionQuality: jpegQuality] : [:]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    guard CGImageDestinationFinalize(destination), rename(temporary, path) == 0 else {
        unlink(temporary)
        return false
    }
    return true
}

func milliseconds(since start: Date) -> Int {
    Int((Date().timeIntervalSince(start) * 1000).rounded())
}

/// 32 位 BGRA、不透明的位图上下文，即 ScreenCaptureKit 输出、ScrollStitcher 使用的格式。
func bgraContext(_ data: UnsafeMutableRawPointer?, width: Int, height: Int) -> CGContext? {
    CGContext(
        data: data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
}

/// 把 BGRA 像素临时包成 CGImage 交给 `body`，不复制数据；图片不能在 `body` 之外继续使用。
func withBGRAImage<Result>(
    _ pixels: [UInt8], width: Int, height: Int, _ body: (CGImage?) -> Result
) -> Result {
    pixels.withUnsafeBytes { buffer in
        guard height > 0, buffer.count >= width * height * 4,
              let provider = CGDataProvider(
                  dataInfo: nil, data: buffer.baseAddress!, size: width * height * 4, releaseData: { _, _, _ in })
        else { return body(nil) }
        let image = CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(
                rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
            provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        return body(image)
    }
}
