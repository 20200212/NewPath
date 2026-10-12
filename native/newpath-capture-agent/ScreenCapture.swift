import CoreGraphics
import Foundation
import ScreenCaptureKit

/// ScreenCaptureKit 报的错误转成错误码：没有屏幕录制权限是 no-permission，其余是 capture-failed。
@available(macOS 12.3, *)
func captureFailure(_ error: Error?) -> (code: String, detail: String?) {
    guard let error else { return (AgentError.captureFailed, nil) }
    let nsError = error as NSError
    if nsError.domain == SCStreamErrorDomain && nsError.code == SCStreamError.Code.userDeclined.rawValue {
        return (AgentError.noPermission, nsError.localizedDescription)
    }
    return (AgentError.captureFailed, String(describing: error))
}

@available(macOS 12.3, *)
func fail(_ id: Int, captureError error: Error?) {
    let failure = captureFailure(error)
    fail(id, failure.code, detail: failure.detail)
}

/// 整屏和单个窗口的截图（SCScreenshotManager，需要 macOS 14）。
/// 整屏截图会把无损的原图留在内存里，选区确定后用 crop 取出一部分，不必再截一次。
@available(macOS 14.0, *)
final class ScreenCapturer {
    private let queue = DispatchQueue(label: "newpath.capture-agent.screen")
    /// 最近一次拿到的显示器列表。获取可共享内容是最慢的一步，而显示器很少变，整屏截图尽量复用。
    private var displays: [SCDisplay] = []
    /// 最近一次整屏截图的原图，release 或下一次整屏截图时丢掉。
    private var frame: CGImage?

    private func shareableContent(_ done: @escaping (SCShareableContent?, Error?) -> Void) {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            self.queue.async {
                if let content { self.displays = content.displays }
                done(content, error)
            }
        }
    }

    /// 提前获取一次可共享内容，让第一次截图更快。只在已经有权限时调用，否则会在启动时就弹出授权框。
    func warm(id: Int) {
        let start = Date()
        shareableContent { content, error in
            if content == nil {
                fail(id, captureError: error)
            } else {
                reply(id, ["ms": milliseconds(since: start)])
            }
        }
    }

    /// 截一整块显示器，原图留在内存里，同时按 path 的扩展名写一份（JPEG 给选区窗口显示用）。
    func captureDisplay(_ displayID: CGDirectDisplayID, path: String, quality: Double, id: Int) {
        let start = Date()
        queue.async {
            // 缓存的显示器被拔掉或者换了分辨率时，重新获取一次
            let size = CGDisplayBounds(displayID).size
            if let display = self.displays.first(where: { $0.displayID == displayID }), display.frame.size == size {
                self.shoot(display, path: path, quality: quality, id: id, start: start)
                return
            }
            self.shareableContent { content, error in
                guard let display = content?.displays.first(where: { $0.displayID == displayID }) else {
                    if content == nil {
                        fail(id, captureError: error)
                    } else {
                        fail(id, AgentError.displayNotFound)
                    }
                    return
                }
                self.shoot(display, path: path, quality: quality, id: id, start: start)
            }
        }
    }

    private func shoot(_ display: SCDisplay, path: String, quality: Double, id: Int, start: Date) {
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let scale = Double(filter.pointPixelScale)
        let shotStart = Date()
        capture(filter, singleWindow: false) { image, error in
            guard let image else {
                fail(id, captureError: error)
                return
            }
            let captured = Date()
            self.queue.async { self.frame = image }
            guard writeImage(image, to: path, jpegQuality: quality) else {
                fail(id, AgentError.writeFailed)
                return
            }
            reply(id, [
                "width": image.width, "height": image.height, "scale": scale,
                "ms": milliseconds(since: start),
                "captureMs": Int((captured.timeIntervalSince(shotStart) * 1000).rounded()),
                "encodeMs": milliseconds(since: captured),
            ])
        }
    }

    /// 从留在内存里的整屏原图中裁出一块，无损写成 PNG。rect 的单位是原图的物理像素。
    func crop(_ rect: CGRect, path: String, id: Int) {
        queue.async {
            guard let frame = self.frame else {
                fail(id, AgentError.noFrame)
                return
            }
            guard CGRect(x: 0, y: 0, width: frame.width, height: frame.height).contains(rect),
                  let cropped = frame.cropping(to: rect)
            else {
                fail(id, AgentError.badRect)
                return
            }
            guard writeImage(cropped, to: path) else {
                fail(id, AgentError.writeFailed)
                return
            }
            reply(id, ["width": cropped.width, "height": cropped.height])
        }
    }

    func release() {
        queue.async { self.frame = nil }
    }

    /// 截单个窗口：不带阴影、圆角外透明，再裁掉四周完全透明的边，写成 PNG。
    func captureWindow(_ windowID: CGWindowID, path: String, id: Int) {
        let start = Date()
        // 窗口变化频繁，每次都重新获取
        shareableContent { content, error in
            guard let window = content?.windows.first(where: { $0.windowID == windowID }) else {
                if content == nil {
                    fail(id, captureError: error)
                } else {
                    fail(id, AgentError.windowNotFound)
                }
                return
            }
            self.capture(SCContentFilter(desktopIndependentWindow: window), singleWindow: true) { image, error in
                guard let image else {
                    fail(id, captureError: error)
                    return
                }
                guard let visible = trimTransparentEdges(image) else {
                    fail(id, AgentError.emptyImage)
                    return
                }
                guard writeImage(visible, to: path) else {
                    fail(id, AgentError.writeFailed)
                    return
                }
                reply(id, ["width": visible.width, "height": visible.height, "ms": milliseconds(since: start)])
            }
        }
    }

    private func capture(_ filter: SCContentFilter, singleWindow: Bool, _ done: @escaping (CGImage?, Error?) -> Void) {
        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = max(1, Int((filter.contentRect.width * scale).rounded()))
        configuration.height = max(1, Int((filter.contentRect.height * scale).rounded()))
        configuration.showsCursor = false
        configuration.captureResolution = .best
        if singleWindow {
            configuration.ignoreShadowsSingleWindow = true
            configuration.shouldBeOpaque = false
        }
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            done(image, error)
        }
    }
}

/// 裁掉四周 alpha 不超过 8 的像素。有些应用把窗口画在一个更大的透明框里，裁完只剩窗口本身。
/// 整张都透明时返回 nil；没有可裁的边时原样返回。
func trimTransparentEdges(_ image: CGImage) -> CGImage? {
    let width = image.width
    let height = image.height
    guard width > 0, height > 0 else { return nil }
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard drawn else { return image }
    // 上下文内存里第 0 行是图片最上面一行
    var left = width, right = -1, top = height, bottom = -1
    for y in 0..<height {
        var first = -1, last = -1
        var index = y * width * 4 + 3
        for x in 0..<width {
            if pixels[index] > 8 {
                if first < 0 { first = x }
                last = x
            }
            index += 4
        }
        guard first >= 0 else { continue }
        left = min(left, first)
        right = max(right, last)
        top = min(top, y)
        bottom = y
    }
    guard right >= left, bottom >= top else { return nil }
    if left == 0 && top == 0 && right == width - 1 && bottom == height - 1 { return image }
    return image.cropping(to: CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1))
}
