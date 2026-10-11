import CoreGraphics
import Foundation

// newpath-window-list <要排除的进程号>
// 输出一行 JSON：屏幕上可见的应用窗口，按 Z 序从前往后，[{"x","y","width","height","title"}]。
// 坐标是全局坐标、单位是点（point），原点在主显示器左上角，与 Electron 的 screen 坐标一致，不需要再换算。

/// 和应用窗口在同一层、但不该被当成窗口识别的系统进程。
let systemOwners: Set<String> = [
    "Window Server", "Dock", "SystemUIServer", "Control Center", "Notification Center",
    "NotificationCenter", "Spotlight", "WindowManager", "screencaptureui", "loginwindow", "Wallpaper",
]

/// 普通窗口在第 0 层，浮动面板（调色板、工具窗）在它上面几层；菜单栏、Dock、屏保等更高的层不参与。
let maximumLayer = Int(CGWindowLevelForKey(.floatingWindow))
let minimumSize: CGFloat = 40
let maximumWindows = 200

let excludedPid = CommandLine.arguments.count > 1 ? Int32(CommandLine.arguments[1]) ?? -1 : -1
let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []

var windows: [[String: Any]] = []
for entry in entries {
    if windows.count >= maximumWindows { break }
    guard
        let layer = entry[kCGWindowLayer as String] as? Int, layer >= 0, layer <= maximumLayer,
        let pid = entry[kCGWindowOwnerPID as String] as? Int32, pid != excludedPid,
        let boundsDictionary = entry[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
        bounds.width >= minimumSize, bounds.height >= minimumSize
    else { continue }
    let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
    if systemOwners.contains(owner) { continue }
    // 完全透明的窗口看不见，也不该被选中
    if let alpha = entry[kCGWindowAlpha as String] as? Double, alpha < 0.05 { continue }
    // 读取窗口标题需要屏幕录制权限；拿不到时用应用名代替
    let name = entry[kCGWindowName as String] as? String ?? ""
    windows.append([
        "x": bounds.minX,
        "y": bounds.minY,
        "width": bounds.width,
        "height": bounds.height,
        "title": name.isEmpty ? owner : name,
    ])
}

let data = (try? JSONSerialization.data(withJSONObject: windows)) ?? Data("[]".utf8)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
