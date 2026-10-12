import CoreGraphics
import Foundation

// 枚举屏幕上可见的应用窗口。newpath-window-list 和 newpath-capture-agent 共用这一份。

/// 和应用窗口在同一组层级、但不该被当成窗口识别的系统进程。
private let systemOwners: Set<String> = [
    "Window Server", "Dock", "SystemUIServer", "Control Center", "Notification Center",
    "NotificationCenter", "Spotlight", "WindowManager", "screencaptureui", "loginwindow", "Wallpaper",
    "TextInputMenuAgent", "TextInputSwitcher", "CursorUIViewService",
]

/// 普通窗口在第 0 层；浮动面板、菜单栏应用弹出的面板在它上面，最高到弹出菜单这一层。
/// 屏保、系统遮罩等更高的层不参与。菜单栏上的状态图标高度不到最小尺寸，会被尺寸条件筛掉。
private let maximumLayer = Int(CGWindowLevelForKey(.popUpMenuWindow))
private let minimumSize: CGFloat = 40
private let minimumAlpha = 0.05
private let maximumWindows = 200

private func activeDisplayBounds() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return [] }
    return displays.prefix(Int(count)).map { CGDisplayBounds($0) }
}

/// 屏幕上可见的应用窗口，按 Z 序从前往后：
/// [{"id","x","y","width","height","title","app"}]
/// id 是 CGWindowID（ScreenCaptureKit 截单个窗口时用它找窗口）；坐标是全局坐标、单位是点，
/// 原点在主显示器左上角，与 Electron 的 screen 坐标一致。
/// 读取窗口标题需要屏幕录制权限，拿不到时 title 用应用名代替。
func listVisibleWindows(excludingPid excludedPid: Int32, excludingWindows excludedWindows: Set<Int> = []) -> [[String: Any]] {
    let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let displays = activeDisplayBounds()

    var windows: [[String: Any]] = []
    for entry in entries {
        if windows.count >= maximumWindows { break }
        guard
            let layer = entry[kCGWindowLayer as String] as? Int, layer >= 0, layer <= maximumLayer,
            let pid = entry[kCGWindowOwnerPID as String] as? Int32, pid != excludedPid,
            let number = entry[kCGWindowNumber as String] as? Int, !excludedWindows.contains(number),
            let boundsDictionary = entry[kCGWindowBounds as String] as? NSDictionary,
            let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
            bounds.width >= minimumSize, bounds.height >= minimumSize
        else { continue }
        let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
        if systemOwners.contains(owner) { continue }
        // 完全透明的窗口看不见，也不该被选中
        if let alpha = entry[kCGWindowAlpha as String] as? Double, alpha < minimumAlpha { continue }
        // 浮在普通窗口之上、又盖满整块屏幕的，是录屏工具、调光软件之类的遮罩，不是要截的窗口
        if layer != 0 && displays.contains(where: { bounds.insetBy(dx: -1, dy: -1).contains($0) }) { continue }
        let name = entry[kCGWindowName as String] as? String ?? ""
        windows.append([
            "id": number,
            "x": bounds.minX,
            "y": bounds.minY,
            "width": bounds.width,
            "height": bounds.height,
            "title": name.isEmpty ? owner : name,
            "app": owner,
        ])
    }
    return windows
}
