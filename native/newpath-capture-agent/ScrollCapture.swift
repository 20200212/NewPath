import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit

/// 一次滚动截图。用 SCStream 持续截显示器上的一块区域（不含鼠标和 NewPath 自己的窗口），
/// 每帧交给 ScrollStitcher，用户滚动页面时长图随之变长。进度以事件行发给 Electron：
///
///   {"event":"scroll","session":<scroll-start 的 id>,"status":…,"height":…,"width":…,"preview":…}
///
/// status：waiting（还没开始拼）、capturing（正在变长）、behind（滚回了已拍过的地方）、
/// lost（和上一帧对不上，需要滚回去一点）、full（达到最大高度）、error（截图流中断，带 detail）。
/// height 是现在结束时长图的高度（像素），preview 是预览 JPEG 的版本号，每重写一次加一。
@available(macOS 12.3, *)
final class ScrollCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    /// 预览图最大宽高（像素）；太长时只保留最新的部分。
    private static let previewWidth: CGFloat = 480
    private static let previewHeight: CGFloat = 720
    private static let previewQuality = 0.8
    private static let previewInterval: TimeInterval = 0.3

    let session: Int
    private let queue = DispatchQueue(label: "newpath.capture-agent.scroll")
    private let stitcher: ScrollStitcher
    private let previewPath: String?
    private var stream: SCStream?
    private var fixtureTimer: DispatchSourceTimer?
    private var stopped = false
    private var status = "waiting"
    private var reportedStatus = ""
    private var reportedHeight = -1
    private var frames = 0
    private var previewVersion = 0
    private var previewWrittenAt = Date.distantPast
    private var previewPending = false

    init(session: Int, width: Int, height: Int, maxHeight: Int, ignoredRight: Int, previewPath: String?) {
        self.session = session
        stitcher = ScrollStitcher(width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight)
        self.previewPath = previewPath
    }

    /// 开始截 `sourceRect`（显示器内的点坐标，原点在该显示器左上角），输出为拼接器的宽高（像素）。
    func start(displayID: CGDirectDisplayID, sourceRect: CGRect, excludingPid: pid_t) {
        let id = session
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            guard let content else {
                fail(id, captureError: error)
                return
            }
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                fail(id, AgentError.displayNotFound)
                return
            }
            let own = content.applications.filter { $0.processID == excludingPid }
            let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.sourceRect = sourceRect
            configuration.width = self.stitcher.width
            configuration.height = self.stitcher.height
            configuration.showsCursor = false
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
            configuration.colorSpaceName = CGColorSpace.sRGB
            // 帧率高一些，两帧之间滚动的距离就小，触控板快速一甩也能对上
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            configuration.queueDepth = 4
            if #available(macOS 14.0, *) { configuration.captureResolution = .best }
            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            do {
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
            } catch {
                fail(id, captureError: error)
                return
            }
            let cancelled = self.queue.sync { () -> Bool in
                if !self.stopped { self.stream = stream }
                return self.stopped
            }
            if cancelled {
                fail(id, AgentError.cancelled)
                return
            }
            stream.startCapture { error in
                if let error {
                    fail(id, captureError: error)
                    return
                }
                reply(id, ["width": self.stitcher.width, "height": self.stitcher.height])
            }
        }
    }

    /// 仅供开发调试：不截屏，而是在一张长图上模拟“滚动”（顶部、底部各有一条不动的栏），
    /// 没有屏幕录制权限也能把整个流程走一遍。图片按拼接器的宽度缩放。
    func startFixture(path: String) {
        let id = session
        let width = stitcher.width
        let height = stitcher.height
        guard
            let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width > 0
        else {
            fail(id, AgentError.fixtureUnreadable)
            return
        }
        let pageHeight = max(height, Int((Double(image.height) * Double(width) / Double(image.width)).rounded()))
        var page = [UInt8](repeating: 255, count: width * pageHeight * 4)
        let drawn = page.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = bgraContext(buffer.baseAddress, width: width, height: pageHeight) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: pageHeight))
            return true
        }
        guard drawn else {
            fail(id, AgentError.fixtureUnreadable)
            return
        }
        let header = height / 8
        let footer = height / 16
        let end = Double(pageHeight - height)
        let screen = Double(height)
        // 停 0.6 秒，滚到 40%，停一下，往回滚 0.3 屏，再一路滚到底
        let middle = end * 0.4
        var keys: [(time: Double, position: Double)] = [(0, 0), (0.6, 0)]
        func move(to position: Double, screensPerSecond speed: Double) {
            let last = keys[keys.count - 1]
            keys.append((last.time + abs(position - last.position) / (screen * speed), position))
        }
        move(to: middle, screensPerSecond: 1)
        keys.append((keys[keys.count - 1].time + 0.4, middle))
        move(to: max(0, middle - screen * 0.3), screensPerSecond: 0.8)
        move(to: end, screensPerSecond: 1.2)
        func position(at time: Double) -> Int {
            guard let next = keys.firstIndex(where: { $0.time > time }) else { return Int(end) }
            let from = keys[max(0, next - 1)]
            let to = keys[next]
            let progress = (time - from.time) / max(0.001, to.time - from.time)
            return Int((from.position + (to.position - from.position) * progress).rounded())
        }

        let rowBytes = width * 4
        var shot = [UInt8](repeating: 0, count: width * height * 4)
        let started = Date()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(33))
        timer.setEventHandler { [weak self] in
            guard let self, !self.stopped else { return }
            let scroll = max(0, min(pageHeight - height, position(at: Date().timeIntervalSince(started))))
            page.withUnsafeBytes { from in
                shot.withUnsafeMutableBytes { to in
                    let source = from.baseAddress!
                    let target = to.baseAddress!
                    target.copyMemory(from: source, byteCount: header * rowBytes)
                    (target + header * rowBytes).copyMemory(
                        from: source + (header + scroll) * rowBytes, byteCount: (height - header - footer) * rowBytes)
                    (target + (height - footer) * rowBytes).copyMemory(
                        from: source + (pageHeight - footer) * rowBytes, byteCount: footer * rowBytes)
                }
            }
            shot.withUnsafeBytes { self.consume($0.baseAddress!, bytesPerRow: rowBytes) }
        }
        let cancelled = queue.sync { () -> Bool in
            if !stopped {
                fixtureTimer = timer
                timer.resume()
            }
            return stopped
        }
        if cancelled {
            fail(id, AgentError.cancelled)
        } else {
            reply(id, ["width": width, "height": height])
        }
    }

    // MARK: SCStreamOutput / SCStreamDelegate

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard
            type == .screen, !stopped, sampleBuffer.isValid,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attachments.first?[.status] as? Int,
            SCFrameStatus(rawValue: rawStatus) == .complete,
            let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard
            CVPixelBufferGetWidth(pixelBuffer) >= stitcher.width,
            CVPixelBufferGetHeight(pixelBuffer) >= stitcher.height,
            let base = CVPixelBufferGetBaseAddress(pixelBuffer)
        else { return }
        consume(base, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard !self.stopped else { return }
            self.status = "error"
            self.report(detail: captureFailure(error).detail)
        }
    }

    // MARK: 控制

    /// 停止并丢掉所有内容；带 id 时回复统计数字。
    func cancel(id: Int?) {
        queue.async {
            self.halt()
            if let id { reply(id, ["stats": self.stats()]) }
        }
    }

    /// 停止并把长图写成 PNG。
    func finish(path: String, id: Int) {
        queue.async {
            self.halt()
            guard let (pixels, rows) = self.stitcher.finish() else {
                fail(id, AgentError.noFrames)
                return
            }
            let width = self.stitcher.width
            let written = withBGRAImage(pixels, width: width, height: rows) { image in
                image.map { writeImage($0, to: path) } ?? false
            }
            if written {
                reply(id, ["width": width, "height": rows, "frames": self.frames, "stats": self.stats()])
            } else {
                fail(id, AgentError.writeFailed)
            }
        }
    }

    // MARK: 以下都在 queue 上运行

    private func halt() {
        stopped = true
        fixtureTimer?.cancel()
        fixtureTimer = nil
        stream?.stopCapture { _ in }
        stream = nil
    }

    /// 诊断用：一共多少帧、丢失了多少帧、丢失了几次、最长一次丢了多少帧。
    private func stats() -> [String: Any] {
        [
            "frames": stitcher.framesSeen, "lost": stitcher.framesLost, "losses": stitcher.lossEpisodes,
            "longestLoss": stitcher.longestLoss,
        ]
    }

    private func consume(_ base: UnsafeRawPointer, bytesPerRow: Int) {
        guard !stopped else { return }
        frames += 1
        switch stitcher.add(base, bytesPerRow: bytesPerRow) {
        case .unchanged:
            // 回到了能对上的位置
            if status == "lost" { status = stitcher.projectedHeight > stitcher.height ? "capturing" : "waiting" }
        case .waiting:
            status = "waiting"
            schedulePreview()
        case .appended:
            status = "capturing"
            schedulePreview()
        case .behind:
            status = "behind"
        case .lost:
            status = "lost"
        case .full:
            if status != "full" {
                status = "full"
                schedulePreview()
            }
        }
        if status != reportedStatus || stitcher.projectedHeight != reportedHeight { report() }
    }

    private func report(detail: String? = nil) {
        reportedStatus = status
        reportedHeight = stitcher.projectedHeight
        var event: [String: Any] = [
            "event": "scroll", "session": session, "status": status, "height": reportedHeight,
            "width": stitcher.width, "preview": previewVersion,
        ]
        if let detail { event["detail"] = detail }
        send(event)
    }

    /// 预览最多每 previewInterval 重写一次，但最后总会追上最新的内容。
    private func schedulePreview() {
        guard previewPath != nil, !previewPending else { return }
        let wait = Self.previewInterval - Date().timeIntervalSince(previewWrittenAt)
        if wait <= 0 {
            writePreview()
            return
        }
        previewPending = true
        queue.asyncAfter(deadline: .now() + wait) {
            self.previewPending = false
            guard !self.stopped else { return }
            self.writePreview()
        }
    }

    private func writePreview() {
        guard let previewPath else { return }
        previewWrittenAt = Date()
        let width = stitcher.width
        let scale = min(1, Self.previewWidth / CGFloat(width))
        let (pixels, rows) = stitcher.newestRows(Int((Self.previewHeight / scale).rounded(.up)))
        guard rows > 0 else { return }
        let targetWidth = max(1, Int((CGFloat(width) * scale).rounded()))
        let targetHeight = max(1, Int((CGFloat(rows) * scale).rounded()))
        let written = withBGRAImage(pixels, width: width, height: rows) { image -> Bool in
            guard let image, let context = bgraContext(nil, width: targetWidth, height: targetHeight) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))
            guard let preview = context.makeImage() else { return false }
            return writeImage(preview, to: previewPath, jpegQuality: Self.previewQuality)
        }
        guard written else { return }
        previewVersion += 1
        report()
    }
}
