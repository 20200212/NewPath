import AppKit
import CoreGraphics
import Foundation

// newpath-capture-agent：macOS 上常驻的截图进程，省掉每次截图启动进程、初始化 ScreenCaptureKit 的时间。
// stdin 每行一个 JSON 请求（带 id），stdout 每行一个 JSON 回复（原样带回 id）：
//   成功 {"id":N,"ok":true,...}，失败 {"id":N,"ok":false,"error":错误码,"detail":说明（可选）}
// 滚动截图的进度是不带 id 的事件行 {"event":"scroll",...}（见 ScrollCapture.swift）。
//
//   {"cmd":"access"}                       是否已有屏幕录制权限 → {"granted"}
//   {"cmd":"request-access"}               申请屏幕录制权限：第一次会把应用登记进系统设置的列表并弹出授权框 → {"granted"}
//   {"cmd":"windows","exclude":pid,"excludeWindows":[CGWindowID…]}
//                                          可见窗口 → {"windows":[{"id","x","y","width","height","title","app"}]}
//   {"cmd":"app-window","bundle":"com.apple.systempreferences"}
//                                          某个应用最前面的窗口（全局点坐标）→ {"x","y","width","height","active"}
//   {"cmd":"warm"}                         有权限时提前准备好 ScreenCaptureKit → {"ms"}
//   {"cmd":"display","display":CGDirectDisplayID,"path":"/…/a.jpg","quality":0.92}
//                                          截整块显示器，原图留在内存里 → {"width","height","scale","ms","captureMs","encodeMs"}
//   {"cmd":"crop","rect":{"x","y","width","height"},"path":"/…/b.png"}
//                                          从留着的原图裁一块（物理像素，整数）→ {"width","height"}
//   {"cmd":"release"}                      丢掉留着的原图
//   {"cmd":"window","window":CGWindowID,"path":"/…/c.png"}
//                                          截单个窗口，不带阴影、裁掉透明边 → {"width","height","ms"}
//   {"cmd":"scroll-start","display":…,"rect":{点坐标},"size":{"width","height"},"exclude":pid,
//    "maxHeight":15000,"preview":"/…/p.jpg","fixture":"/…/page.png"}
//                                          开始滚动截图 → {"width","height"}，之后发 scroll 事件
//   {"cmd":"scroll-finish","path":"/…/d.png"}  写出长图 → {"width","height","frames","stats"}
//   {"cmd":"scroll-cancel"}                放弃滚动截图 → {"stats"}（没有进行中的也回复成功）
//
// 截图类命令（warm / display / crop / window）需要 macOS 14，滚动截图需要 macOS 12.3，
// 更老的系统回复 "unsupported"，由 Electron 退回原来的截图方式。stdin 关闭（NewPath 退出）时进程退出。

private let screenCapturer: AnyObject? = {
    if #available(macOS 14.0, *) { return ScreenCapturer() }
    return nil
}()

/// 进行中的滚动截图，只在 scrollQueue 上读写。同一时间最多一个，开始新的会停掉旧的。
private let scrollQueue = DispatchQueue(label: "newpath.capture-agent.scroll-control")
private var activeScroll: AnyObject?

private func handle(_ request: [String: Any]) {
    guard let id = intValue(request["id"]) else { return }
    guard let command = request["cmd"] as? String else {
        fail(id, AgentError.badRequest)
        return
    }
    switch command {
    case "access":
        reply(id, ["granted": CGPreflightScreenCaptureAccess()])
    case "request-access":
        // 授权框由系统弹出；放到主线程上调用
        DispatchQueue.main.async {
            reply(id, ["granted": CGRequestScreenCaptureAccess()])
        }
    case "windows":
        let exclude = intValue(request["exclude"]).map { Int32(truncatingIfNeeded: $0) } ?? -1
        let excludedWindows = Set((request["excludeWindows"] as? [Any] ?? []).compactMap { intValue($0) })
        reply(id, ["windows": listVisibleWindows(excludingPid: exclude, excludingWindows: excludedWindows)])
    case "app-window":
        appWindow(request, id: id)
    case "warm", "display", "crop", "window", "release":
        screenCommand(command, request, id: id)
    case "scroll-start", "scroll-finish", "scroll-cancel":
        scrollCommand(command, request, id: id)
    default:
        fail(id, AgentError.unknownCommand)
    }
}

/// 另一个应用（默认是系统设置）最前面的普通窗口在哪里，比如让引导窗口贴着它显示。读取窗口位置不需要屏幕录制权限。
private func appWindow(_ request: [String: Any], id: Int) {
    let bundle = request["bundle"] as? String ?? "com.apple.systempreferences"
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first else {
        fail(id, AgentError.notRunning)
        return
    }
    let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    for entry in entries {
        guard
            let pid = entry[kCGWindowOwnerPID as String] as? Int32, pid == app.processIdentifier,
            let layer = entry[kCGWindowLayer as String] as? Int, layer == 0,
            let boundsDictionary = entry[kCGWindowBounds as String] as? NSDictionary,
            let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
            bounds.width >= 200, bounds.height >= 150
        else { continue }
        reply(id, [
            "x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height,
            "active": app.isActive,
        ])
        return
    }
    fail(id, AgentError.noWindow)
}

private func screenCommand(_ command: String, _ request: [String: Any], id: Int) {
    guard #available(macOS 14.0, *), let capturer = screenCapturer as? ScreenCapturer else {
        // 老系统上没有留着的原图，release 照样算成功
        if command == "release" {
            reply(id)
        } else {
            fail(id, AgentError.unsupported)
        }
        return
    }
    switch command {
    case "warm":
        // 没有权限时去问 ScreenCaptureKit 会在启动时就弹出授权框，应该等到用户第一次截图
        guard CGPreflightScreenCaptureAccess() else {
            fail(id, AgentError.noPermission)
            return
        }
        capturer.warm(id: id)
    case "display":
        guard
            let display = intValue(request["display"]),
            let path = pathValue(request["path"], extensions: [".jpg", ".jpeg", ".png"])
        else {
            fail(id, AgentError.badRequest)
            return
        }
        let quality = min(1, max(0.1, doubleValue(request["quality"]) ?? 0.92))
        capturer.captureDisplay(CGDirectDisplayID(truncatingIfNeeded: display), path: path, quality: quality, id: id)
    case "crop":
        guard
            let path = pathValue(request["path"], extensions: [".png"]),
            let object = request["rect"] as? [String: Any],
            let x = intValue(object["x"]), let y = intValue(object["y"]),
            let width = intValue(object["width"]), let height = intValue(object["height"]),
            width > 0, height > 0
        else {
            fail(id, AgentError.badRequest)
            return
        }
        capturer.crop(CGRect(x: x, y: y, width: width, height: height), path: path, id: id)
    case "window":
        guard let window = intValue(request["window"]), let path = pathValue(request["path"], extensions: [".png"]) else {
            fail(id, AgentError.badRequest)
            return
        }
        capturer.captureWindow(CGWindowID(truncatingIfNeeded: window), path: path, id: id)
    default:
        capturer.release()
        reply(id)
    }
}

private func scrollCommand(_ command: String, _ request: [String: Any], id: Int) {
    guard #available(macOS 12.3, *) else {
        if command == "scroll-cancel" {
            reply(id)
        } else {
            fail(id, command == "scroll-start" ? AgentError.unsupported : AgentError.noScroll)
        }
        return
    }
    switch command {
    case "scroll-start":
        startScroll(request, id: id)
    case "scroll-finish":
        guard let path = pathValue(request["path"], extensions: [".png"]) else {
            fail(id, AgentError.badRequest)
            return
        }
        scrollQueue.async {
            guard let scroll = activeScroll as? ScrollCapture else {
                fail(id, AgentError.noScroll)
                return
            }
            activeScroll = nil
            scroll.finish(path: path, id: id)
        }
    default:
        scrollQueue.async {
            guard let scroll = activeScroll as? ScrollCapture else {
                reply(id)
                return
            }
            activeScroll = nil
            scroll.cancel(id: id)
        }
    }
}

@available(macOS 12.3, *)
private func startScroll(_ request: [String: Any], id: Int) {
    let fixture = pathValue(request["fixture"], extensions: [".png", ".jpg", ".jpeg"])
    let rect = rectValue(request["rect"])
    let display = intValue(request["display"])
    guard
        let size = request["size"] as? [String: Any],
        let width = intValue(size["width"]), let height = intValue(size["height"]),
        (8...16384).contains(width), (8...16384).contains(height),
        fixture != nil || (rect != nil && display != nil)
    else {
        fail(id, AgentError.badRequest)
        return
    }
    let maxHeight = min(32000, max(height, intValue(request["maxHeight"]) ?? 15000))
    let exclude = intValue(request["exclude"]).map { pid_t(truncatingIfNeeded: $0) } ?? -1
    let preview = pathValue(request["preview"], extensions: [".jpg", ".jpeg"])
    // 右侧约 16 点宽的一条不参与匹配：滚动时那里会冒出浮动滚动条
    let ignoredRight = rect.map { Int((16 * Double(width) / $0.width).rounded()) } ?? 0
    scrollQueue.async {
        (activeScroll as? ScrollCapture)?.cancel(id: nil)
        let scroll = ScrollCapture(
            session: id, width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight,
            previewPath: preview)
        activeScroll = scroll
        if let fixture {
            scroll.startFixture(path: fixture)
        } else if let rect, let display {
            scroll.start(displayID: CGDirectDisplayID(truncatingIfNeeded: display), sourceRect: rect, excludingPid: exclude)
        }
    }
}

// 读 stdin 放在后台线程，主线程留给 dispatchMain（CGRequestScreenCaptureAccess 要在主线程上调用）
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard
            let data = line.data(using: .utf8),
            let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { continue }
        handle(request)
    }
    // stdin 关了：NewPath 已退出。写完排队中的回复再走
    flushOutput()
    exit(0)
}

dispatchMain()
