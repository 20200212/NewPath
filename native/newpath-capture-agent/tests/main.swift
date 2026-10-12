import Foundation

// ScrollStitcher 的测试：每一帧都从一张已知的长页面上截出来，拼对了就能原样还原这张页面。
// 运行：npm run test:scroll-stitcher

/// BGRA 位图，每行 width * 4 字节。
struct Bitmap {
    let width: Int
    var height: Int
    var pixels: [UInt8]

    init(width: Int, height: Int, gray: UInt8 = 255) {
        self.width = width
        self.height = height
        pixels = [UInt8](repeating: gray, count: width * height * 4)
    }

    /// 像文字的墨迹：边长 `cell` 的随机小点，每一行都和相邻的行不同，就像穿过真实文字的一行行像素。
    mutating func ink(x: Int, y: Int, width w: Int, height h: Int, shade: UInt8, cell: Int, random: inout Random) {
        for top in stride(from: y, to: y + h, by: cell) {
            for left in stride(from: x, to: x + w, by: cell) where random.next(100) < 45 {
                fill(x: left, y: top, width: cell, height: min(cell, y + h - top), b: shade, g: shade, r: shade)
            }
        }
    }

    mutating func fill(x: Int, y: Int, width w: Int, height h: Int, b: UInt8, g: UInt8, r: UInt8) {
        guard max(0, y) < min(height, y + h), max(0, x) < min(width, x + w) else { return }
        for row in max(0, y)..<min(height, y + h) {
            for column in max(0, x)..<min(width, x + w) {
                let index = (row * width + column) * 4
                pixels[index] = b
                pixels[index + 1] = g
                pixels[index + 2] = r
                pixels[index + 3] = 255
            }
        }
    }

    func rows(_ range: Range<Int>) -> ArraySlice<UInt8> {
        pixels[(range.lowerBound * width * 4)..<(range.upperBound * width * 4)]
    }
}

struct Random {
    var state: UInt64
    mutating func next(_ bound: Int) -> Int {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return Int(state % UInt64(bound))
    }
}

/// 类似网页的长页面：彩色标题栏，一行行“文字”、标题、图片，可选一段很长的空白，最后是底部栏。
func makePage(width: Int, height: Int, seed: UInt64 = 7, blankGap: Int = 0) -> Bitmap {
    var page = Bitmap(width: width, height: height)
    var random = Random(state: seed)
    page.fill(x: 0, y: 0, width: width, height: 52, b: 160, g: 90, r: 40)
    page.fill(x: 16, y: 18, width: 120, height: 16, b: 255, g: 255, r: 255)
    var y = 70
    var gapPlaced = blankGap == 0
    while y < height - 60 {
        if !gapPlaced && y > height / 2 {
            y += blankGap
            gapPlaced = true
            continue
        }
        switch random.next(10) {
        case 0:
            // 图片
            let tall = 80 + random.next(120)
            page.fill(
                x: 24 + random.next(80), y: y, width: width / 2, height: tall,
                b: UInt8(random.next(200)), g: UInt8(random.next(200)), r: UInt8(random.next(200)))
            y += tall + 18
        case 1:
            // 标题
            var x = 24
            while x < width / 2 {
                let word = 20 + random.next(70)
                page.ink(x: x, y: y, width: word, height: 22, shade: 30, cell: 3, random: &random)
                x += word + 14
            }
            y += 40
        default:
            // 一行文字
            var x = 24
            let end = width - 40 - random.next(width / 3)
            while x < end {
                let word = 8 + random.next(60)
                let shade = UInt8(40 + random.next(60))
                page.ink(x: x, y: y + random.next(3), width: word, height: 12, shade: shade, cell: 2, random: &random)
                x += word + 7
            }
            y += 24
        }
    }
    page.fill(x: 0, y: height - 44, width: width, height: 44, b: 70, g: 70, r: 70)
    page.fill(x: 24, y: height - 30, width: 200, height: 14, b: 210, g: 210, r: 210)
    return page
}

/// 页面滚动到 `scroll` 时屏幕上看到的样子：开头 `header` 行和最后 `footer` 行不动，其余跟着滚。
func frame(_ page: Bitmap, height: Int, header: Int, footer: Int, scroll: Int) -> Bitmap {
    var shot = Bitmap(width: page.width, height: height)
    let rowBytes = page.width * 4
    func copy(from sourceRow: Int, to targetRow: Int, count: Int) {
        guard count > 0 else { return }
        shot.pixels.replaceSubrange(
            (targetRow * rowBytes)..<((targetRow + count) * rowBytes),
            with: page.pixels[(sourceRow * rowBytes)..<((sourceRow + count) * rowBytes)])
    }
    copy(from: 0, to: 0, count: header)
    copy(from: header + scroll, to: header, count: height - header - footer)
    copy(from: page.height - footer, to: height - footer, count: footer)
    return shot
}

func maxScroll(_ page: Bitmap, height: Int) -> Int { page.height - height }

final class Run {
    let stitcher: ScrollStitcher
    var outcomes: [ScrollStitcher.Outcome] = []
    init(width: Int, height: Int, maxHeight: Int = 100_000, ignoredRight: Int = 0) {
        stitcher = ScrollStitcher(width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight)
    }
    @discardableResult
    func add(_ shot: Bitmap) -> ScrollStitcher.Outcome {
        let outcome = shot.pixels.withUnsafeBytes { stitcher.add($0.baseAddress!, bytesPerRow: shot.width * 4) }
        outcomes.append(outcome)
        return outcome
    }
    func finish() -> Bitmap {
        let rows = stitcher.finish() ?? 0
        var image = Bitmap(width: stitcher.width, height: rows)
        image.pixels = stitcher.output
        return image
    }
}

var failures = 0
func check(_ condition: Bool, _ message: @autoclosure () -> String) {
    if !condition {
        failures += 1
        print("    失败：\(message())")
    }
}

func test(_ name: String, _ body: () -> Void) {
    let before = failures
    body()
    print(failures == before ? "pass \(name)" : "FAIL \(name)")
}

/// 两张图第一处不同的行；只比较从 `left` 到 `columns` 的列。
func firstDifference(_ a: Bitmap, _ b: Bitmap, columns: Int? = nil, from left: Int = 0) -> Int? {
    let compared = (columns ?? a.width) * 4
    for row in 0..<min(a.height, b.height) {
        let start = row * a.width * 4
        if a.pixels[(start + left * 4)..<(start + compared)] != b.pixels[(start + left * 4)..<(start + compared)] { return row }
    }
    return a.height == b.height ? nil : min(a.height, b.height)
}

func expectSame(_ result: Bitmap, _ expected: Bitmap, columns: Int? = nil, from left: Int = 0) {
    check(result.height == expected.height, "高度 \(result.height)，应为 \(expected.height)")
    if let row = firstDifference(result, expected, columns: columns, from: left) {
        check(false, "从第 \(row) 行开始不同")
    }
}

/// 按 `positions` 依次滚动，把整张页面滚一遍。
func stitch(_ page: Bitmap, height: Int, header: Int, footer: Int, positions: [Int], ignoredRight: Int = 0) -> (Run, Bitmap) {
    let run = Run(width: page.width, height: height, ignoredRight: ignoredRight)
    for position in positions {
        run.add(frame(page, height: height, header: header, footer: footer, scroll: position))
    }
    return (run, run.finish())
}

func steps(from start: Int, to end: Int, by step: Int) -> [Int] {
    var values: [Int] = []
    var value = start
    while step > 0 ? value < end : value > end {
        values.append(value)
        value += step
    }
    values.append(end)
    return values
}

let width = 640
let height = 480

test("匀速滚动还原整张页面") {
    let page = makePage(width: width, height: 3000)
    let (_, result) = stitch(page, height: height, header: 0, footer: 0, positions: steps(from: 0, to: maxScroll(page, height: height), by: 37))
    expectSame(result, page)
}

test("固定的顶部栏和底部栏只出现一次") {
    let page = makePage(width: width, height: 3200, seed: 11)
    let (_, result) = stitch(page, height: height, header: 52, footer: 44, positions: steps(from: 0, to: maxScroll(page, height: height), by: 61))
    expectSame(result, page)
}

test("快慢不均、停顿、往回滚再继续") {
    let page = makePage(width: width, height: 4000, seed: 23)
    let end = maxScroll(page, height: height)
    var positions = [0, 0, 3, 9, 30, 30, 30, 90, 200, 360]
    positions += [300, 220, 150, 220, 300, 400, 410]
    positions += steps(from: 410, to: end, by: 133)
    positions += [end, end]
    let (run, result) = stitch(page, height: height, header: 52, footer: 44, positions: positions)
    expectSame(result, page)
    check(run.outcomes.contains(.behind), "往回滚应报告 behind")
    check(run.outcomes.contains(.unchanged), "停顿应报告 unchanged")
}

test("长段空白不影响拼接") {
    let page = makePage(width: width, height: 3600, seed: 5, blankGap: 220)
    let (_, result) = stitch(page, height: height, header: 52, footer: 44, positions: steps(from: 0, to: maxScroll(page, height: height), by: 45))
    expectSame(result, page)
}

test("一下滚过头会丢失，滚回来后接上") {
    let page = makePage(width: width, height: 3000, seed: 31)
    let end = maxScroll(page, height: height)
    let run = Run(width: width, height: height)
    for position in [0, 100, 200, 1200] { run.add(frame(page, height: height, header: 52, footer: 44, scroll: position)) }
    check(run.outcomes.last == .lost, "跳过重叠部分应报告 lost，实际 \(String(describing: run.outcomes.last))")
    for position in [600, 300] + steps(from: 300, to: end, by: 90) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    expectSame(run.finish(), page)
    check(run.stitcher.lostEpisodes == 1, "连续丢失算一次，实际 \(run.stitcher.lostEpisodes)")
}

test("从开始向下滚的地方开始拼") {
    let page = makePage(width: width, height: 3000, seed: 41)
    let end = maxScroll(page, height: height)
    // 先在中间，往上滚到 200，再一路往下
    let positions = [900, 700, 500, 350, 200] + steps(from: 200, to: end, by: 70)
    let (run, result) = stitch(page, height: height, header: 52, footer: 44, positions: positions)
    var expected = Bitmap(width: width, height: page.height - 200)
    expected.pixels = Array(page.rows(0..<52)) + Array(page.rows(252..<page.height))
    expectSame(result, expected)
    check(run.outcomes.prefix(5).allSatisfy { $0 == .waiting }, "开始前都是 waiting：\(run.outcomes.prefix(5))")
}

test("开始滚动前跟着窗口的变化走") {
    let page = makePage(width: width, height: 2600, seed: 43)
    let run = Run(width: width, height: height)
    // 窗口还没激活：标题栏是灰的，不是彩色的
    var inactive = frame(page, height: height, header: 52, footer: 44, scroll: 0)
    inactive.fill(x: 0, y: 0, width: width, height: 52, b: 200, g: 200, r: 200)
    run.add(inactive)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 50) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    expectSame(run.finish(), page)
}

test("忽略右侧浮动滚动条") {
    let page = makePage(width: width, height: 3000, seed: 53)
    let end = maxScroll(page, height: height)
    let run = Run(width: width, height: height, ignoredRight: 20)
    for position in steps(from: 0, to: end, by: 55) {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // 滑块跟着滚动位置移动，滑轨变深
        shot.fill(x: width - 14, y: 0, width: 10, height: height, b: 225, g: 225, r: 225)
        shot.fill(x: width - 12, y: position * (height - 80) / max(1, end), width: 6, height: 80, b: 120, g: 120, r: 120)
        run.add(shot)
    }
    expectSame(run.finish(), page, columns: width - 20)
}

test("鼠标下的悬停高亮不影响拼接") {
    let page = makePage(width: width, height: 3000, seed: 61)
    let run = Run(width: width, height: height)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 64) {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // 鼠标所在的 y = 200 附近那几行变成浅蓝
        for row in 188..<212 {
            for column in 0..<width {
                let index = (row * width + column) * 4
                shot.pixels[index] = shot.pixels[index] / 2 + 120
            }
        }
        run.add(shot)
    }
    let result = run.finish()
    check(result.height == page.height, "高度 \(result.height)，应为 \(page.height)")
    // 每一行保留最后一次看到的样子，所以只剩最后一帧的高亮
    let last = maxScroll(page, height: height)
    var dirty: [Int] = []
    for row in 0..<result.height where result.rows(row..<(row + 1)) != page.rows(row..<(row + 1)) { dirty.append(row) }
    check(dirty.allSatisfy { (last + 188)..<(last + 212) ~= $0 }, "高亮残留在别处：\(dirty.prefix(5))")
}

test("停住时图片加载完成，最终是加载后的样子") {
    let page = makePage(width: width, height: 3000, seed: 101)
    let run = Run(width: width, height: height)
    var loaded = page
    // 页面停住时有一张图片加载完成
    loaded.fill(x: 100, y: 700, width: 300, height: 120, b: 20, g: 140, r: 220)
    for position in [0, 60, 120, 180] { run.add(frame(page, height: height, header: 52, footer: 44, scroll: position)) }
    run.add(frame(loaded, height: height, header: 52, footer: 44, scroll: 180))
    for position in steps(from: 180, to: maxScroll(page, height: height), by: 70) {
        run.add(frame(loaded, height: height, header: 52, footer: 44, scroll: position))
    }
    check(!run.outcomes.contains(.lost), "不应丢失：\(run.outcomes)")
    expectSame(run.finish(), loaded)
}

test("滚动途中加载的图片以加载后为准") {
    let page = makePage(width: width, height: 3000, seed: 103)
    var loaded = page
    loaded.fill(x: 60, y: 900, width: 500, height: 160, b: 200, g: 60, r: 120)
    let run = Run(width: width, height: height)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 50) {
        // 滚过 700 之前还是占位图
        run.add(frame(position < 700 ? page : loaded, height: height, header: 52, footer: 44, scroll: position))
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    expectSame(run.finish(), loaded)
}

test("下半部分正在淡入也能跟上") {
    let page = makePage(width: width, height: 3000, seed: 107)
    let run = Run(width: width, height: height)
    for (index, position) in steps(from: 0, to: maxScroll(page, height: height), by: 45).enumerated() {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // 每三帧有一帧下半部分还在淡入：字迹更浅
        if index % 3 == 1 {
            for row in (height / 2)..<height {
                for column in 0..<width {
                    let i = (row * width + column) * 4
                    for channel in 0..<3 { shot.pixels[i + channel] = UInt8(255 - (255 - Int(shot.pixels[i + channel])) * 6 / 10) }
                }
            }
        }
        run.add(shot)
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    let result = run.finish()
    check(result.height == page.height, "height \(result.height), expected \(page.height)")
}

test("整体亮度轻微变化也能对上") {
    let page = makePage(width: width, height: 2400, seed: 113)
    let run = Run(width: width, height: height)
    for (index, position) in steps(from: 0, to: maxScroll(page, height: height), by: 50).enumerated() {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // 隔一帧整体亮 3 级，比如显示器亮度、夜览在变
        if index % 2 == 1 {
            for i in stride(from: 0, to: shot.pixels.count, by: 4) {
                for channel in 0..<3 where shot.pixels[i + channel] <= 251 { shot.pixels[i + channel] += 3 }
            }
        }
        run.add(shot)
    }
    check(!run.outcomes.contains(.lost), "不应丢失：\(run.outcomes)")
    check(run.finish().height == page.height, "高度应为 \(page.height)")
}

test("吸顶侧栏只出现一次，下面是空白") {
    let page = makePage(width: width, height: 3000, seed: 109)
    let run = Run(width: width, height: height)
    var sidebar = Bitmap(width: 120, height: height)
    for row in stride(from: 70, to: height - 40, by: 26) { sidebar.fill(x: 14, y: row, width: 80, height: 10, b: 160, g: 90, r: 40) }
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 60) {
        var shot = frame(page, height: height, header: 52, footer: 44, scroll: position)
        for row in 52..<(height - 44) {
            let target = (row * width) * 4
            shot.pixels.replaceSubrange(target..<(target + 120 * 4), with: sidebar.pixels[(row * 120 * 4)..<((row + 1) * 120 * 4)])
        }
        run.add(shot)
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    let result = run.finish()
    check(result.height == page.height, "height \(result.height), expected \(page.height)")
    // 第一屏以下很远的地方，侧栏那一列只有背景色
    var marked = 0
    for row in (height + 200)..<(result.height - height) {
        for column in 0..<110 where result.pixels[(row * width + column) * 4] != 255 { marked += 1 }
    }
    check(marked == 0, "侧栏有 \(marked) 个像素在长图下方重复出现")
    expectSame(Bitmap(width: width, height: result.height).withPixels(result.pixels[...]), page, columns: nil, from: 120)
}

test("达到最大高度就停止") {
    let page = makePage(width: width, height: 5000, seed: 71)
    let run = Run(width: width, height: height, maxHeight: 2000)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 80) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    check(run.outcomes.contains(.full), "应报告 full")
    let result = run.finish()
    check(result.height == 2000, "高度 \(result.height)，应为 2000")
    if let row = firstDifference(result, Bitmap(width: width, height: 1956).withPixels(page.rows(0..<1956))) {
        check(row >= 1956, "内容从第 \(row) 行开始不同")
    }
}

test("一直不动就得到那一帧") {
    let page = makePage(width: width, height: 2000, seed: 83)
    let still = frame(page, height: height, header: 52, footer: 44, scroll: 300)
    let (run, result) = stitch(page, height: height, header: 52, footer: 44, positions: [300, 300, 300])
    expectSame(result, still)
    check(run.outcomes == [.waiting, .unchanged, .unchanged], "结果 \(run.outcomes)")
}

test("进度里的高度随滚动增加") {
    let page = makePage(width: width, height: 2400, seed: 89)
    let run = Run(width: width, height: height)
    run.add(frame(page, height: height, header: 52, footer: 44, scroll: 0))
    check(run.stitcher.projectedHeight == height, "第一帧 \(run.stitcher.projectedHeight)")
    let outcome = run.add(frame(page, height: height, header: 52, footer: 44, scroll: 120))
    check(outcome == .appended(120), "结果 \(outcome)")
    check(run.stitcher.projectedHeight == height + 120, "滚了 120 行后 \(run.stitcher.projectedHeight)")
    var pixels: [UInt8] = []
    run.stitcher.withSegments { segments in
        for segment in segments {
            pixels += UnsafeRawBufferPointer(start: segment.pixels, count: segment.rows * width * 4)
        }
    }
    check(pixels.count == (height + 120) * width * 4, "分段里有 \(pixels.count / (width * 4)) 行")
    // 页面开头 height + 120 - 44 行，加上底部栏
    let expected = page.rows(0..<(height + 120 - 44)) + page.rows((page.height - 44)..<page.height)
    check(pixels[...] == expected, "分段内容不对")
}

test("大尺寸帧足够快") {
    let large = makePage(width: 1600, height: 9000, seed: 97)
    let run = Run(width: 1600, height: 1800, ignoredRight: 40)
    let frames = steps(from: 0, to: maxScroll(large, height: 1800), by: 180).map {
        frame(large, height: 1800, header: 52, footer: 44, scroll: $0)
    }
    let start = Date()
    for shot in frames { run.add(shot) }
    let perFrame = Date().timeIntervalSince(start) / Double(frames.count) * 1000
    print(String(format: "     每帧 1600x1800 用时 %.1f ms", perFrame))
    check(perFrame < 60, "太慢，跟不上实时截图")
    expectSame(run.finish(), large, columns: 1560)
}

extension Bitmap {
    func withPixels(_ slice: ArraySlice<UInt8>) -> Bitmap {
        var copy = self
        copy.pixels = Array(slice)
        copy.height = slice.count / (width * 4)
        return copy
    }
}

if failures > 0 {
    print("\(failures) 项检查失败")
    exit(1)
}
print("滚动拼接测试全部通过")
