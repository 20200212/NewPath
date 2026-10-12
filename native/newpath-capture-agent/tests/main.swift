import Foundation

// ScrollStitcher 的测试：每一帧都从一张已知的长页面上截出来，拼对了就能原样还原这张页面。
// 运行：node scripts/test-scroll-stitcher.mjs

/// BGRA 位图，每行 width * 4 字节。
struct Image {
    let width: Int
    var height: Int
    var pixels: [UInt8]

    init(width: Int, height: Int, gray: UInt8 = 250) {
        self.width = width
        self.height = height
        pixels = [UInt8](repeating: gray, count: width * height * 4)
    }

    init(width: Int, rows: ArraySlice<UInt8>) {
        self.width = width
        height = rows.count / (width * 4)
        pixels = Array(rows)
    }

    mutating func fill(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ color: (UInt8, UInt8, UInt8)) {
        let left = max(0, x), right = min(width, x + w)
        let top = max(0, y), bottom = min(height, y + h)
        guard left < right, top < bottom else { return }
        for row in top..<bottom {
            for column in left..<right {
                let index = (row * width + column) * 4
                pixels[index] = color.0
                pixels[index + 1] = color.1
                pixels[index + 2] = color.2
                pixels[index + 3] = 255
            }
        }
    }

    /// 改写一块区域里每个像素的颜色通道。
    mutating func adjust(rows: Range<Int>, columns: Range<Int>? = nil, _ change: (UInt8) -> UInt8) {
        for row in rows {
            for column in columns ?? 0..<width {
                let index = (row * width + column) * 4
                for channel in 0..<3 { pixels[index + channel] = change(pixels[index + channel]) }
            }
        }
    }

    func rows(_ range: Range<Int>) -> ArraySlice<UInt8> {
        pixels[(range.lowerBound * width * 4)..<(range.upperBound * width * 4)]
    }
}

/// 可重复的伪随机数（线性同余）。
struct Seeded {
    var state: UInt64
    mutating func next(_ bound: Int) -> Int {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Int((state >> 33) % UInt64(bound))
    }
}

/// 类似网页的长页面：顶部色条，若干段“文字”（一行行小块）、标题、图片，可选一段很长的空白，底部色条。
func makePage(width: Int, height: Int, seed: UInt64, blank: Int = 0) -> Image {
    var page = Image(width: width, height: height)
    var random = Seeded(state: seed)
    page.fill(0, 0, width, 52, (150, 100, 50))
    page.fill(20, 16, 140, 20, (250, 250, 250))
    var y = 64
    var blankDone = blank == 0
    while y < height - 56 {
        if !blankDone && y > height / 2 {
            y += blank
            blankDone = true
            continue
        }
        let kind = random.next(12)
        if kind == 0 {
            let tall = 60 + random.next(140)
            let color = (UInt8(random.next(220)), UInt8(random.next(220)), UInt8(random.next(220)))
            page.fill(30 + random.next(60), y, width / 2 + random.next(width / 4), tall, color)
            // 图片里也画点细节，免得整块都是纯色
            for _ in 0..<12 {
                page.fill(40 + random.next(width / 2), y + random.next(tall), 6 + random.next(30), 3, (255, 255, 255))
            }
            y += tall + 16
        } else {
            let lineHeight = kind == 1 ? 20 : 11
            var x = 24
            let end = width - 30 - random.next(width / 3)
            while x < end {
                let word = 6 + random.next(kind == 1 ? 80 : 50)
                let shade = UInt8(20 + random.next(90))
                // 一个“词”由随机的小方块组成，每一行都不一样，像真实文字的笔画
                var row = y
                while row < y + lineHeight {
                    var column = x
                    while column < min(x + word, end) {
                        if random.next(100) < 40 { page.fill(column, row, 2, 2, (shade, shade, shade)) }
                        column += 2
                    }
                    row += 2
                }
                x += word + 6
            }
            y += lineHeight + 9 + random.next(6)
        }
    }
    page.fill(0, height - 44, width, 44, (60, 60, 64))
    page.fill(24, height - 30, 180, 14, (200, 200, 200))
    return page
}

/// 页面滚动到 `scroll` 时屏幕上看到的样子：开头 `header` 行和最后 `footer` 行不动，其余跟着滚。
func view(_ page: Image, height: Int, header: Int, footer: Int, scroll: Int) -> Image {
    var shot = Image(width: page.width, height: height)
    let rowBytes = page.width * 4
    func copy(_ from: Int, _ to: Int, _ count: Int) {
        guard count > 0 else { return }
        shot.pixels.replaceSubrange(
            (to * rowBytes)..<((to + count) * rowBytes), with: page.pixels[(from * rowBytes)..<((from + count) * rowBytes)])
    }
    copy(0, 0, header)
    copy(header + scroll, header, height - header - footer)
    copy(page.height - footer, height - footer, footer)
    return shot
}

final class Session {
    let stitcher: ScrollStitcher
    var outcomes: [ScrollStitcher.Outcome] = []

    init(width: Int, height: Int, maxHeight: Int = 100_000, ignoredRight: Int = 0) {
        stitcher = ScrollStitcher(width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight)
    }

    @discardableResult
    func feed(_ shot: Image) -> ScrollStitcher.Outcome {
        let outcome = shot.pixels.withUnsafeBytes { stitcher.add($0.baseAddress!, bytesPerRow: shot.width * 4) }
        outcomes.append(outcome)
        return outcome
    }

    func result() -> Image {
        guard let (pixels, rows) = stitcher.finish() else { return Image(width: stitcher.width, height: 0) }
        var image = Image(width: stitcher.width, height: rows)
        image.pixels = pixels
        return image
    }
}

var failed = 0

func expect(_ condition: Bool, _ message: @autoclosure () -> String) {
    if !condition {
        failed += 1
        print("    \(message())")
    }
}

func test(_ name: String, _ body: () -> Void) {
    let before = failed
    body()
    print(failed == before ? "pass \(name)" : "FAIL \(name)")
}

/// 第一处不同的行；只比较 [from, to) 这些列。
func firstDifferentRow(_ a: Image, _ b: Image, columns: Range<Int>? = nil) -> Int? {
    let range = columns ?? 0..<a.width
    for row in 0..<min(a.height, b.height) {
        let start = row * a.width * 4
        if a.pixels[(start + range.lowerBound * 4)..<(start + range.upperBound * 4)]
            != b.pixels[(start + range.lowerBound * 4)..<(start + range.upperBound * 4)]
        {
            return row
        }
    }
    return nil
}

func expectEqual(_ actual: Image, _ expected: Image, columns: Range<Int>? = nil) {
    expect(actual.height == expected.height, "高度 \(actual.height)，应为 \(expected.height)")
    if let row = firstDifferentRow(actual, expected, columns: columns) { expect(false, "从第 \(row) 行开始不同") }
}

/// 从 from 每次滚 step 行，最后停在 to。
func positions(_ from: Int, _ to: Int, by step: Int) -> [Int] {
    Array(stride(from: from, to: to, by: step)) + [to]
}

func scrollThrough(
    _ page: Image, height: Int, header: Int, footer: Int, at scrolls: [Int], ignoredRight: Int = 0
) -> Session {
    let session = Session(width: page.width, height: height, ignoredRight: ignoredRight)
    for scroll in scrolls { session.feed(view(page, height: height, header: header, footer: footer, scroll: scroll)) }
    return session
}

let width = 600
let height = 420

test("匀速滚动还原整张页面") {
    let page = makePage(width: width, height: 2800, seed: 1)
    let session = scrollThrough(page, height: height, header: 0, footer: 0, at: positions(0, page.height - height, by: 41))
    expectEqual(session.result(), page)
    expect(!session.outcomes.contains(.lost), "不应丢失：\(session.outcomes)")
}

test("固定的顶部栏和底部栏只出现一次") {
    let page = makePage(width: width, height: 3000, seed: 2)
    let session = scrollThrough(page, height: height, header: 52, footer: 44, at: positions(0, page.height - height, by: 57))
    expectEqual(session.result(), page)
}

test("快慢不均、停顿、往回滚再继续") {
    let page = makePage(width: width, height: 3600, seed: 3)
    let end = page.height - height
    var scrolls = [0, 0, 2, 7, 25, 25, 80, 190, 300]
    scrolls += [260, 180, 120, 200, 310, 330]
    scrolls += positions(330, end, by: 117) + [end, end]
    let session = scrollThrough(page, height: height, header: 52, footer: 44, at: scrolls)
    expectEqual(session.result(), page)
    expect(session.outcomes.contains(.behind), "往回滚应报告 behind")
    expect(session.outcomes.contains(.unchanged), "停顿应报告 unchanged")
}

test("长段空白不影响拼接") {
    let page = makePage(width: width, height: 3400, seed: 4, blank: 200)
    let session = scrollThrough(page, height: height, header: 52, footer: 44, at: positions(0, page.height - height, by: 43))
    expectEqual(session.result(), page)
}

test("一下滚过头会丢失，滚回来后接上") {
    let page = makePage(width: width, height: 3000, seed: 5)
    let session = Session(width: width, height: height)
    for scroll in [0, 90, 180, 1100] { session.feed(view(page, height: height, header: 52, footer: 44, scroll: scroll)) }
    expect(session.outcomes.last == .lost, "跳过重叠部分应报告 lost，实际 \(String(describing: session.outcomes.last))")
    for scroll in [700, 260] + positions(260, page.height - height, by: 80) {
        session.feed(view(page, height: height, header: 52, footer: 44, scroll: scroll))
    }
    expectEqual(session.result(), page)
    expect(session.stitcher.lossEpisodes == 1, "连续丢失算一次，实际 \(session.stitcher.lossEpisodes)")
    expect(session.stitcher.framesLost == 2, "丢失 2 帧，实际 \(session.stitcher.framesLost)")
}

test("从开始向下滚的地方开始拼") {
    let page = makePage(width: width, height: 3000, seed: 6)
    // 先在中间，往上滚到 180，再一路往下
    let scrolls = [800, 640, 470, 330, 180] + positions(180, page.height - height, by: 66)
    let session = scrollThrough(page, height: height, header: 52, footer: 44, at: scrolls)
    let expected = Image(width: width, rows: page.rows(0..<52) + page.rows((52 + 180)..<page.height))
    expectEqual(session.result(), expected)
    expect(session.outcomes.prefix(5).allSatisfy { $0 == .waiting }, "开始前都是 waiting：\(session.outcomes.prefix(5))")
}

test("开始滚动前窗口的变化不会留下") {
    let page = makePage(width: width, height: 2500, seed: 7)
    let session = Session(width: width, height: height)
    // 窗口还没激活：标题栏是灰的
    var inactive = view(page, height: height, header: 52, footer: 44, scroll: 0)
    inactive.fill(0, 0, width, 52, (190, 190, 190))
    session.feed(inactive)
    for scroll in positions(0, page.height - height, by: 48) {
        session.feed(view(page, height: height, header: 52, footer: 44, scroll: scroll))
    }
    expectEqual(session.result(), page)
}

test("忽略右侧浮动滚动条") {
    let page = makePage(width: width, height: 2800, seed: 8)
    let end = page.height - height
    let session = Session(width: width, height: height, ignoredRight: 18)
    for scroll in positions(0, end, by: 52) {
        var shot = view(page, height: height, header: 0, footer: 0, scroll: scroll)
        shot.fill(width - 13, 0, 9, height, (220, 220, 220))
        shot.fill(width - 11, scroll * (height - 70) / end, 5, 70, (110, 110, 110))
        session.feed(shot)
    }
    expectEqual(session.result(), page, columns: 0..<(width - 18))
}

test("鼠标下的悬停高亮不影响拼接") {
    let page = makePage(width: width, height: 2800, seed: 9)
    let end = page.height - height
    let session = Session(width: width, height: height)
    for scroll in positions(0, end, by: 60) {
        var shot = view(page, height: height, header: 0, footer: 0, scroll: scroll)
        // 屏幕上第 180–204 行（鼠标所在的那一行）变成浅蓝
        shot.adjust(rows: 180..<204) { $0 / 2 + 110 }
        session.feed(shot)
    }
    expect(!session.outcomes.contains(.lost), "不应丢失")
    let result = session.result()
    expect(result.height == page.height, "高度 \(result.height)，应为 \(page.height)")
    // 每一行保留最后一次看到的样子，所以只剩最后一帧的高亮
    var dirty: [Int] = []
    for row in 0..<min(result.height, page.height) where result.rows(row..<(row + 1)) != page.rows(row..<(row + 1)) {
        dirty.append(row)
    }
    expect(dirty.allSatisfy { (end + 180)..<(end + 204) ~= $0 }, "高亮残留在别处：\(dirty.prefix(6))")
}

test("停住时图片加载完成，最终是加载后的样子") {
    let page = makePage(width: width, height: 2800, seed: 10)
    var loaded = page
    loaded.fill(80, 560, 320, 110, (30, 150, 210))
    let session = Session(width: width, height: height)
    for scroll in [0, 70, 140, 200] { session.feed(view(page, height: height, header: 52, footer: 44, scroll: scroll)) }
    session.feed(view(loaded, height: height, header: 52, footer: 44, scroll: 200))
    for scroll in positions(200, page.height - height, by: 75) {
        session.feed(view(loaded, height: height, header: 52, footer: 44, scroll: scroll))
    }
    expect(!session.outcomes.contains(.lost), "不应丢失：\(session.outcomes)")
    expectEqual(session.result(), loaded)
}

test("滚动途中加载的图片以加载后为准") {
    let page = makePage(width: width, height: 2800, seed: 11)
    var loaded = page
    loaded.fill(50, 860, 480, 150, (190, 70, 110))
    let session = Session(width: width, height: height)
    for scroll in positions(0, page.height - height, by: 55) {
        session.feed(view(scroll < 640 ? page : loaded, height: height, header: 52, footer: 44, scroll: scroll))
    }
    expect(!session.outcomes.contains(.lost), "不应丢失")
    expectEqual(session.result(), loaded)
}

test("下半部分正在淡入也能跟上") {
    let page = makePage(width: width, height: 2800, seed: 12)
    let session = Session(width: width, height: height)
    for (index, scroll) in positions(0, page.height - height, by: 47).enumerated() {
        var shot = view(page, height: height, header: 0, footer: 0, scroll: scroll)
        if index % 3 == 1 { shot.adjust(rows: (height / 2)..<height) { UInt8(255 - (255 - Int($0)) * 6 / 10) } }
        session.feed(shot)
    }
    expect(!session.outcomes.contains(.lost), "不应丢失：\(session.outcomes)")
    expect(session.result().height == page.height, "高度 \(session.result().height)，应为 \(page.height)")
}

test("整体亮度轻微变化时用容差匹配") {
    let page = makePage(width: width, height: 2400, seed: 13)
    let session = Session(width: width, height: height)
    for (index, scroll) in positions(0, page.height - height, by: 50).enumerated() {
        var shot = view(page, height: height, header: 0, footer: 0, scroll: scroll)
        if index % 2 == 1 { shot.adjust(rows: 0..<height) { $0 > 251 ? $0 : $0 + 3 } }
        session.feed(shot)
    }
    let steps = session.outcomes.dropFirst().dropLast()
    expect(steps.allSatisfy { $0 == .appended(50) }, "每次都应滚 50 行：\(session.outcomes)")
    expect(session.result().height == page.height, "高度 \(session.result().height)，应为 \(page.height)")
}

test("不跟着滚的侧栏不影响匹配") {
    let page = makePage(width: width, height: 2800, seed: 14)
    var sidebar = Image(width: 110, height: height)
    for row in stride(from: 70, to: height - 50, by: 24) { sidebar.fill(12, row, 80, 9, (150, 100, 50)) }
    let session = Session(width: width, height: height)
    for scroll in positions(0, page.height - height, by: 58) {
        var shot = view(page, height: height, header: 52, footer: 44, scroll: scroll)
        for row in 52..<(height - 44) {
            let target = row * width * 4
            shot.pixels.replaceSubrange(target..<(target + 110 * 4), with: sidebar.rows(row..<(row + 1)))
        }
        session.feed(shot)
    }
    expect(!session.outcomes.contains(.lost), "不应丢失")
    let result = session.result()
    expect(result.height == page.height, "高度 \(result.height)，应为 \(page.height)")
    expectEqual(result, page, columns: 110..<width)
}

test("达到最大高度就停止") {
    let page = makePage(width: width, height: 5000, seed: 15)
    let session = Session(width: width, height: height, maxHeight: 1800)
    for scroll in positions(0, page.height - height, by: 77) {
        session.feed(view(page, height: height, header: 52, footer: 44, scroll: scroll))
    }
    expect(session.outcomes.contains(.full), "应报告 full")
    let result = session.result()
    expect(result.height == 1800, "高度 \(result.height)，应为 1800")
    // 上面是页面内容，最后 44 行是底部栏
    let body = Image(width: width, rows: page.rows(0..<1756))
    if let row = firstDifferentRow(Image(width: width, rows: result.rows(0..<1756)), body) { expect(false, "内容从第 \(row) 行开始不同") }
    expect(result.rows(1756..<1800) == page.rows((page.height - 44)..<page.height), "最后是底部栏")
}

test("一直不动就得到那一帧") {
    let page = makePage(width: width, height: 2000, seed: 16)
    let still = view(page, height: height, header: 52, footer: 44, scroll: 260)
    let session = scrollThrough(page, height: height, header: 52, footer: 44, at: [260, 260, 260])
    expectEqual(session.result(), still)
    expect(session.outcomes == [.waiting, .unchanged, .unchanged], "结果 \(session.outcomes)")
}

test("进度里的高度随滚动增加") {
    let page = makePage(width: width, height: 2400, seed: 17)
    let session = Session(width: width, height: height)
    session.feed(view(page, height: height, header: 52, footer: 44, scroll: 0))
    expect(session.stitcher.projectedHeight == height, "第一帧 \(session.stitcher.projectedHeight)")
    let outcome = session.feed(view(page, height: height, header: 52, footer: 44, scroll: 110))
    expect(outcome == .appended(110), "结果 \(outcome)")
    expect(session.stitcher.projectedHeight == height + 110, "滚了 110 行后 \(session.stitcher.projectedHeight)")
    let newest = session.stitcher.newestRows(100)
    expect(newest.rows == 100, "预览行数 \(newest.rows)")
    // 最新的 100 行：页面第 430–486 行，加上底部栏
    let expected = page.rows(430..<486) + page.rows((page.height - 44)..<page.height)
    expect(newest.pixels[...] == expected, "预览内容不对")
    let all = session.stitcher.newestRows(10_000)
    expect(all.rows == height + 110, "全部行数 \(all.rows)")
}

test("大尺寸帧足够快") {
    let page = makePage(width: 1600, height: 9000, seed: 18)
    let session = Session(width: 1600, height: 1800, ignoredRight: 40)
    let shots = positions(0, page.height - 1800, by: 170).map { view(page, height: 1800, header: 52, footer: 44, scroll: $0) }
    let start = Date()
    for shot in shots { session.feed(shot) }
    let perFrame = Date().timeIntervalSince(start) / Double(shots.count) * 1000
    print(String(format: "     每帧 1600x1800 用时 %.1f ms", perFrame))
    expect(perFrame < 50, "太慢，跟不上实时截图")
    expectEqual(session.result(), page, columns: 0..<1560)
}

if failed > 0 {
    print("\(failed) 项检查失败")
    exit(1)
}
print("滚动拼接测试全部通过")
