import AppKit
import Foundation

// swift scripts/list-mac-app-registrations.swift <Bundle ID>
// 输出一行 JSON：{"preferred": 默认打开的副本路径或 null, "registered": [LaunchServices 里注册的全部副本路径]}。
// 由 scripts/mac-app-registration.mjs 调用，安装后核对 NewPath 只剩 /Applications 下这一份注册。

guard CommandLine.arguments.count == 2 else {
    fputs("用法：swift list-mac-app-registrations.swift <Bundle ID>\n", stderr)
    exit(2)
}

let identifier = CommandLine.arguments[1]
let workspace = NSWorkspace.shared
let result: [String: Any] = [
    "preferred": workspace.urlForApplication(withBundleIdentifier: identifier)?.path as Any? ?? NSNull(),
    "registered": workspace.urlsForApplications(withBundleIdentifier: identifier).map(\.path),
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
