import Foundation

// newpath-window-list <要排除的进程号> [要排除的窗口 id...]
// 输出一行 JSON：屏幕上可见的应用窗口，按 Z 序从前往后，字段见 WindowList.swift。
// 进程号为 -1 表示不排除任何进程。

let arguments = CommandLine.arguments.dropFirst()
let excludedPid = arguments.first.flatMap { Int32($0) } ?? -1
let excludedWindows = Set(arguments.dropFirst().compactMap { Int($0) })

let windows = listVisibleWindows(excludingPid: excludedPid, excludingWindows: excludedWindows)
let data = (try? JSONSerialization.data(withJSONObject: windows)) ?? Data("[]".utf8)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
