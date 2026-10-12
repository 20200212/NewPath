import Foundation

/// 把正在滚动的一块区域逐帧拼成一张长图。
///
/// 帧是 32 位 BGRA。每帧都和它的上一帧（只早几十毫秒）比较，所以原地变化的内容
/// （懒加载的图片、渐显、跳动的时钟、悬停高亮）不会让拼接器一直拿着过期的参照帧。
/// 顶部、底部不动的行（工具栏、吸顶标题、页脚）不参与搜索；行按列段比较，
/// 一行里局部变化不会挡住其余部分的匹配。列段像素基本一致、或者形状相关时算匹配，
/// 所以滚进来时逐渐变深的文字也能对上；其余部分在滚、自己不动的列（吸顶侧栏）完全不参与匹配。
///
/// 长图是以第一帧为坐标的画布。每张拼进来的帧都把它显示的行画到画布上，所以每一行保留最后一次
/// 看到的样子：加载好的图片替换占位图，浮动按钮只留在最后看到它的地方。固定的顶部栏来自第一帧，
/// 固定的底部栏来自滚得最远的那一帧；吸顶侧栏只出现一次，下面是它的背景。
///
/// 第一次向下滚动之前，拼接器一直跟着最新的一帧：窗口可以先稳定下来（NewPath 让开后它才变成活动窗口），
/// 用户也可以先往上滚到想要开始的地方。
///
/// 纯逻辑，不依赖 ScreenCaptureKit，可以单独编译测试（见 tests/main.swift）。
final class ScrollStitcher {
    enum Outcome: Equatable {
        /// 画面没有滚动，内容可能原地变了。
        case unchanged
        /// 还没开始，这一帧成为新的起点。
        case waiting
        /// 长图增加了这么多行。
        case appended(Int)
        /// 往回滚到了长图里已经有的行。
        case behind
        /// 和上一帧找不到重叠，比如滚得非常快。
        case lost
        /// 长图达到 `maxHeight`，之后的帧都不再处理。
        case full
    }

    /// 参与比较的列的亮度，以及每行、每个列段的摘要。
    private struct Analysis {
        var luma: [UInt8]
        var hashes: [UInt64]
        /// 有细节的行，即不是一种纯色。
        var detailed: [Bool]
        /// 同上，按列段，每行 `segments` 个。
        var segmentDetailed: [Bool]
        var segmentHashes: [UInt64]
        /// 每行在 `profileBands` 个列带上的亮度和。
        var profile: [Int32]
    }

    private static let segments = 16
    private static let profileBands = 8
    /// 亮度差超过这么多才算真的不同，而不是噪声。
    private static let tolerance: Int16 = 24
    /// 有细节的列段里，至少要有这么大比例对得上才算匹配。
    private static let minimumScore = 0.6
    /// 精确匹配的列段达到这么多，单凭它们就足以确定位移。
    private static let convincingVotes = 24

    let width: Int
    let height: Int
    let maxHeight: Int
    /// 从左边算起参与比较的列数。剩下的部分（滚动时出现浮动滚动条的地方）照样拷贝，但不比较。
    let columns: Int

    /// 开发用：描述每一步的判断。截图进程里为 nil。
    var trace: ((String) -> Void)?

    /// 截图过程中是画布；`finish()` 之后是拼好的长图。
    private(set) var output: [UInt8] = []
    private(set) var outputRows = 0
    private(set) var isFull = false
    /// 是否已经开始，即是否向下滚过。
    private(set) var started = false

    private var previous: Analysis?
    /// 上一帧的像素，开始之前一直保留。
    private var previousPixels: [UInt8] = []
    /// 上一帧相对第一帧滚了多远。
    private var previousScroll = 0
    private var lastShift = 0
    /// 连续多少帧没能拼上。
    private var lostStreak = 0
    /// 诊断日志用的数字，从不包含图像内容。
    private(set) var framesSeen = 0
    private(set) var framesLost = 0
    private(set) var lostEpisodes = 0
    private(set) var longestLoss = 0
    /// 每次丢失时第一帧的情况，例如 "f212 band 1180 max 1062 last 240 best 310@0.41/12v still 0.08"。
    private(set) var lossNotes: [String] = []
    private var attempt = ""
    /// 页面滚动时不动的列段（吸顶侧栏）：它们说明不了滚动，匹配时跳过。
    private var stillColumns = [Bool](repeating: false, count: segments)
    /// 帧里这一行以上是固定的顶部栏，取自第一帧。
    private var headerRows = 0
    private var canvasRows = 0
    /// 滚得最远的那一帧提供固定的底部栏。
    private var deepestScroll = 0
    private var deepestBottom = 0
    private var footer: [UInt8] = []

    /// - Parameter ignoredRight: 右侧不参与匹配的列数，用来避开滚动时才出现的浮动滚动条。
    init(width: Int, height: Int, maxHeight: Int, ignoredRight: Int = 0) {
        precondition(width > 0 && height > 0)
        self.width = width
        self.height = height
        self.maxHeight = max(height, maxHeight)
        columns = max(1, width - min(max(0, ignoredRight), width / 4))
    }

    /// 最近拼上的那一帧相对第一帧滚了多少行。
    var scrollOffset: Int { previousScroll }

    /// 现在结束的话长图有多高。
    var projectedHeight: Int {
        guard previous != nil else { return 0 }
        return started ? min(maxHeight, deepestScroll + height) : height
    }

    /// 加入一帧。`base` 指向第一行，每行 `bytesPerRow` 字节（不小于 width * 4）。
    func add(_ base: UnsafeRawPointer, bytesPerRow: Int) -> Outcome {
        if isFull { return .full }
        framesSeen += 1
        let frame = analyze(base, bytesPerRow: bytesPerRow)
        guard let last = previous else {
            follow(frame, base, bytesPerRow: bytesPerRow)
            return .waiting
        }

        var top = 0
        while top < height && rowStays(last, frame, top) { top += 1 }
        if top == height { return .unchanged }
        var bottom = height
        while bottom > top && rowStays(last, frame, bottom - 1) { bottom -= 1 }

        let found = findShift(last, frame, top: top, bottom: bottom)
        trace?("band \(top)..<\(bottom) shift \(found.map(String.init) ?? "none")")
        guard let shift = found else {
            if started {
                lostStreak += 1
                framesLost += 1
                longestLoss = max(longestLoss, lostStreak)
                if lostStreak == 1 {
                    lostEpisodes += 1
                    if lossNotes.count < 12 { lossNotes.append("f\(framesSeen) band \(top)..<\(bottom) last \(lastShift) \(attempt)") }
                }
                return .lost
            }
            follow(frame, base, bytesPerRow: bytesPerRow)
            return .waiting
        }
        if !started {
            guard shift > 0 else {
                follow(frame, base, bytesPerRow: bytesPerRow)
                return .waiting
            }
            begin(top: top, bottom: bottom)
        }

        let scroll = previousScroll + shift
        if scroll + height > maxHeight {
            isFull = true
            return .full
        }
        // 永远不在画布已有内容的下面留缺口。原地变化时，变化区上面的行就是页面本身，能填上。
        if shift != 0 && scroll + max(top, headerRows) > canvasRows { return .lost }
        let before = projectedHeight
        if shift != 0 { stillColumns = stillSegments(last, frame, shift: shift, top: top, bottom: bottom) }
        paint(base, bytesPerRow: bytesPerRow, scroll: scroll, top: top, bottom: bottom, moved: shift != 0, still: stillColumns)
        previous = frame
        previousScroll = scroll
        lostStreak = 0
        if shift != 0 { lastShift = shift }
        // 比最深处只差几行，是页面到底后的回弹，不是用户往上滚。
        if deepestScroll - scroll > height / 10 { return .behind }
        let grown = projectedHeight - before
        return grown > 0 ? .appended(grown) : .unchanged
    }

    /// 完成长图并返回它的高度；一帧都没有时返回 nil。之后 `output` 里就是长图（BGRA，每行 width * 4 字节）。
    func finish() -> Int? {
        guard previous != nil else { return nil }
        if started {
            let rows = min(canvasRows, deepestScroll + deepestBottom)
            output.removeSubrange((rows * width * 4)...)
            output.append(contentsOf: footer)
            outputRows = min(maxHeight, rows + height - deepestBottom)
            output.removeSubrange((outputRows * width * 4)...)
        } else {
            output = previousPixels
            outputRows = height
        }
        previous = nil
        previousPixels = []
        footer = []
        return outputRows
    }

    /// 到目前为止的长图，按从上到下的若干段行给出。
    func withSegments<T>(_ body: ([(pixels: UnsafeRawPointer, rows: Int)]) -> T) -> T {
        if !started {
            return previousPixels.withUnsafeBytes { frame in
                guard previous != nil, let base = frame.baseAddress else { return body([]) }
                return body([(base, height)])
            }
        }
        return output.withUnsafeBytes { canvas in
            footer.withUnsafeBytes { bottomBar in
                var segments: [(pixels: UnsafeRawPointer, rows: Int)] = []
                let rows = min(canvasRows, deepestScroll + deepestBottom)
                if rows > 0, let base = canvas.baseAddress { segments.append((base, rows)) }
                if deepestBottom < height, let base = bottomBar.baseAddress {
                    segments.append((base, height - deepestBottom))
                }
                return body(segments)
            }
        }
    }

    // MARK: - 画布

    /// 开始之前，最新的一帧就是起点。
    private func follow(_ frame: Analysis, _ base: UnsafeRawPointer, bytesPerRow: Int) {
        previous = frame
        previousScroll = 0
        let rowBytes = width * 4
        if previousPixels.count != rowBytes * height {
            previousPixels = [UInt8](repeating: 0, count: rowBytes * height)
        }
        previousPixels.withUnsafeMutableBytes { target in
            for y in 0..<height {
                target.baseAddress!.advanced(by: y * rowBytes).copyMemory(from: base + y * bytesPerRow, byteCount: rowBytes)
            }
        }
    }

    /// 上一帧成为长图的顶部。
    private func begin(top: Int, bottom: Int) {
        let rowBytes = width * 4
        started = true
        headerRows = top
        output.reserveCapacity(rowBytes * min(maxHeight, height * 4))
        output.append(contentsOf: previousPixels[0..<(bottom * rowBytes)])
        canvasRows = bottom
        deepestScroll = 0
        deepestBottom = bottom
        footer = Array(previousPixels[(bottom * rowBytes)...])
        previousScroll = 0
        previousPixels = []
    }

    /// 把这一帧显示的行画到画布上。滚动时固定栏下面最上方的六分之一不画：
    /// 页面滚动后才吸顶的栏，否则会出现在长图中间。
    private func paint(
        _ base: UnsafeRawPointer, bytesPerRow: Int, scroll: Int, top: Int, bottom: Int, moved: Bool, still: [Bool]
    ) {
        let rowBytes = width * 4
        let floor = max(top, headerRows)
        var from = moved ? max(floor, headerRows + (height - headerRows) / 6) : floor
        from = max(moved ? floor : headerRows, min(from, canvasRows - scroll))
        from = max(from, headerRows - scroll)
        if bottom > from {
            let existing = canvasRows
            let end = scroll + bottom
            if end > canvasRows {
                output.append(contentsOf: repeatElement(0, count: (end - canvasRows) * rowBytes))
                canvasRows = end
            }
            // 长图里已有的行，保留右侧浮动滚动条时隐时现的那一条，以及其余部分在滚、自己不动的列
            // （吸顶侧栏）：重画它们会把它们拖成一长条。
            let segmentWidth = max(1, columns / Self.segments)
            var spans: [(start: Int, count: Int)] = []
            for segment in 0..<Self.segments where !(still.indices.contains(segment) && still[segment]) {
                let start = segment * segmentWidth * 4
                let end = (segment == Self.segments - 1 ? columns : (segment + 1) * segmentWidth) * 4
                if let last = spans.last, last.start + last.count == start {
                    spans[spans.count - 1].count += end - start
                } else {
                    spans.append((start, end - start))
                }
            }
            // 新的行里这种列填成它的背景色，吸顶侧栏就像整页截图那样只在顶部出现一次。
            var fills: [(start: Int, count: Int, pixel: UInt32)] = []
            for segment in still.indices where still[segment] {
                let start = segment * segmentWidth
                let end = segment == Self.segments - 1 ? columns : (segment + 1) * segmentWidth
                fills.append((start, end - start, commonPixel(base, bytesPerRow: bytesPerRow, columns: start..<end, rows: top..<bottom)))
            }
            output.withUnsafeMutableBytes { canvas in
                for y in from..<bottom {
                    let target = canvas.baseAddress!.advanced(by: (scroll + y) * rowBytes)
                    let source = base + y * bytesPerRow
                    if scroll + y >= existing {
                        target.copyMemory(from: source, byteCount: rowBytes)
                        for fill in fills {
                            let pixels = (target + fill.start * 4).assumingMemoryBound(to: UInt32.self)
                            for x in 0..<fill.count { pixels[x] = fill.pixel }
                        }
                    } else {
                        for span in spans { (target + span.start).copyMemory(from: source + span.start, byteCount: span.count) }
                    }
                }
            }
        }
        if scroll >= deepestScroll {
            deepestScroll = scroll
            deepestBottom = bottom
            footer.removeAll(keepingCapacity: true)
            for y in bottom..<height {
                footer.append(contentsOf: UnsafeRawBufferPointer(start: base + y * bytesPerRow, count: rowBytes))
            }
        }
    }

    // MARK: - 匹配

    private func analyze(_ base: UnsafeRawPointer, bytesPerRow: Int) -> Analysis {
        let columns = self.columns
        let segments = Self.segments
        let segmentWidth = max(1, columns / segments)
        var luma = [UInt8](repeating: 0, count: columns * height)
        var hashes = [UInt64](repeating: 0, count: height)
        var detailed = [Bool](repeating: false, count: height)
        var segmentDetailed = [Bool](repeating: false, count: height * segments)
        var segmentHashes = [UInt64](repeating: 0, count: height * segments)
        var profile = [Int32](repeating: 0, count: height * Self.profileBands)
        luma.withUnsafeMutableBufferPointer { lumaRows in
            for y in 0..<height {
                let source = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
                let target = lumaRows.baseAddress! + y * columns
                var rowHash: UInt64 = 0xcbf2_9ce4_8422_2325
                var rowLow: UInt8 = 255
                var rowHigh: UInt8 = 0
                for segment in 0..<segments {
                    let start = min(columns, segment * segmentWidth)
                    let end = segment == segments - 1 ? columns : min(columns, start + segmentWidth)
                    var sum: Int32 = 0
                    var hash: UInt64 = 0xcbf2_9ce4_8422_2325 &+ UInt64(segment)
                    var low: UInt8 = 255
                    var high: UInt8 = 0
                    var x = start
                    while x < end {
                        let pixel = source + x * 4
                        let value = UInt8(
                            (UInt32(pixel[2]) * 77 + UInt32(pixel[1]) * 150 + UInt32(pixel[0]) * 29) >> 8)
                        target[x] = value
                        hash = (hash ^ UInt64(value)) &* 0x0000_0100_0000_01b3
                        if value < low { low = value }
                        if value > high { high = value }
                        sum += Int32(value)
                        x += 1
                    }
                    segmentDetailed[y * segments + segment] = end > start && Int16(high) - Int16(low) > Self.tolerance
                    segmentHashes[y * segments + segment] = hash
                    rowHash = (rowHash ^ hash) &* 0x0000_0100_0000_01b3
                    profile[y * Self.profileBands + segment * Self.profileBands / segments] += sum
                    if low < rowLow { rowLow = low }
                    if high > rowHigh { rowHigh = high }
                }
                hashes[y] = rowHash
                detailed[y] = Int16(rowHigh) - Int16(rowLow) > Self.tolerance
            }
        }
        return Analysis(
            luma: luma, hashes: hashes, detailed: detailed, segmentDetailed: segmentDetailed,
            segmentHashes: segmentHashes, profile: profile)
    }

    /// 两行里的某个列段看起来是否一样：像素几乎相同（容许抗锯齿和光标边缘），
    /// 或者形状相同只是深浅不同，比如页面滚动时文字逐渐显现。
    private func segmentMatches(
        _ a: Analysis, _ rowA: Int, _ b: Analysis, _ rowB: Int, _ segment: Int, sameShadeOnly: Bool = false
    ) -> Bool {
        let columns = self.columns
        let segmentWidth = max(1, columns / Self.segments)
        let start = min(columns, segment * segmentWidth)
        let end = segment == Self.segments - 1 ? columns : min(columns, start + segmentWidth)
        let allowed = (end - start) / 25 + 1
        return a.luma.withUnsafeBufferPointer { lumaA in
            b.luma.withUnsafeBufferPointer { lumaB in
                let first = lumaA.baseAddress! + rowA * columns
                let second = lumaB.baseAddress! + rowB * columns
                var differing = 0
                var x = start
                while x < end {
                    let difference = Int16(first[x]) - Int16(second[x])
                    if difference > Self.tolerance || difference < -Self.tolerance {
                        differing += 1
                        if differing > allowed { break }
                    }
                    x += 1
                }
                if differing <= allowed { return true }
                if sameShadeOnly { return false }
                // 归一化相关不受亮度、对比度变化的影响。
                var sumA: Int64 = 0, sumB: Int64 = 0, squaresA: Int64 = 0, squaresB: Int64 = 0, products: Int64 = 0
                for x in start..<end {
                    let p = Int64(first[x])
                    let q = Int64(second[x])
                    sumA += p
                    sumB += q
                    squaresA += p * p
                    squaresB += q * q
                    products += p * q
                }
                let n = Int64(end - start)
                let varianceA = Double(n * squaresA - sumA * sumA)
                let varianceB = Double(n * squaresB - sumB * sumB)
                let covariance = Double(n * products - sumA * sumB)
                // 两边都要有真正的结构：至少横跨这个列段有一条淡淡的边。
                let floor = Double(n * n) * 40
                guard varianceA > floor, varianceB > floor, covariance > 0 else { return false }
                return covariance * covariance >= 0.85 * varianceA * varianceB
            }
        }
    }

    /// 某一行在两帧之间是否没动：完全相同，或者至多一个列段不同（时钟、悬停高亮）。
    private func rowStays(_ a: Analysis, _ b: Analysis, _ row: Int) -> Bool {
        if a.hashes[row] == b.hashes[row] { return true }
        var differing = 0
        for segment in 0..<Self.segments where !segmentMatches(a, row, b, row, segment, sameShadeOnly: true) {
            differing += 1
            if differing > 1 { return false }
        }
        return true
    }

    /// `current` 相对 `previous` 滚了多少行（正数为向下滚；0 表示原地变化），什么都对不上时返回 nil。
    private func findShift(_ previous: Analysis, _ current: Analysis, top: Int, bottom: Int) -> Int? {
        let band = bottom - top
        // 只剩十分之一的重叠也足够匹配了。
        let maxShift = max(0, band - max(24, band / 10))
        let votes = segmentVotes(previous, current, top: top, bottom: bottom, maxShift: maxShift)
        let stillVotes = Int(votes[maxShift])
        var ranked: [(shift: Int, votes: Int)] = []
        for (index, count) in votes.enumerated() where count >= 2 && index != maxShift {
            ranked.append((index - maxShift, Int(count)))
        }
        ranked.sort { $0.votes > $1.votes }

        // 压倒性的精确证据直接定案，即使中间很多地方在变（图片加载、悬停从一张卡片移到另一张）。
        if let leader = ranked.first {
            let runnerUp = ranked.dropFirst().first { abs($0.shift - leader.shift) > 2 }?.votes ?? 0
            // 不动的列（吸顶侧栏）在其余部分滚动时会投“没动”的票，所以只要压过“没动”的一半。
            if leader.votes >= Self.convincingVotes && leader.votes >= 2 * runnerUp && 2 * leader.votes >= stillVotes,
               let score = score(previous, current, shift: leader.shift, from: top, to: bottom, need: 0.15)
            {
                trace?("  votes settle \(leader.shift) (\(leader.votes) vs still \(stillVotes), next \(runnerUp)) score \(String(format: "%.2f", score))")
                return leader.shift
            }
        }
        if stillVotes >= Self.convincingVotes && stillVotes >= 2 * (ranked.first?.votes ?? 0) {
            trace?("  votes settle still (\(stillVotes) vs \(ranked.first?.votes ?? 0))")
            return 0
        }

        var candidates = Array(ranked.prefix(3))
        if maxShift >= 1 {
            candidates += profileShifts(previous, current, top: top, bottom: bottom, maxShift: maxShift).map { ($0, 0) }
            if lastShift != 0 && abs(lastShift) <= maxShift { candidates.append((lastShift, 0)) }
        }
        var moving: (shift: Int, score: Double, votes: Int)?
        var tried = Set<Int>()
        for candidate in candidates where tried.insert(candidate.shift).inserted {
            let votes = Int(votes[candidate.shift + maxShift])
            let score = self.score(previous, current, shift: candidate.shift, from: top, to: bottom, need: Self.minimumScore)
            trace?("  candidate \(candidate.shift) votes \(votes) score \(score.map { String(format: "%.2f", $0) } ?? "-")")
            guard let score, score >= Self.minimumScore else { continue }
            if let leader = moving {
                // 得分明显更高的胜出；否则看证据多少，再看和用户原来的滚动速度是否接近。
                if score < leader.score - 0.02 { continue }
                if score <= leader.score + 0.02 {
                    if votes < leader.votes { continue }
                    if votes == leader.votes && abs(candidate.shift - lastShift) >= abs(leader.shift - lastShift) {
                        continue
                    }
                }
            }
            moving = (candidate.shift, score, votes)
        }

        // 原地变化（视频在播放、图片在加载）：中间大部分仍对得上原来的位置，或者整帧大部分没动。
        let bandStill = score(previous, current, shift: 0, from: top, to: bottom) ?? 0
        let frameStill = bandStill >= Self.minimumScore
            ? bandStill : (score(previous, current, shift: 0, from: 0, to: height, need: 0.7) ?? 0)
        let still = bandStill >= Self.minimumScore || frameStill >= 0.7
        trace?("  still band \(String(format: "%.2f", bandStill)) frame \(String(format: "%.2f", frameStill)) votes \(stillVotes)")

        if let moving, !still || moving.votes > stillVotes || moving.score > bandStill + 0.05 { return moving.shift }
        if still { return 0 }

        // 滚动的同时中间很大一块变了（图片滚进视野时才加载）：没有哪个位移对得很好，
        // 但可能有一个比其他的好得多。
        var scored: [(shift: Int, score: Double)] = []
        for shift in tried {
            if let value = score(previous, current, shift: shift, from: top, to: bottom) { scored.append((shift, value)) }
        }
        scored.sort { $0.score > $1.score }
        let leading = scored.first.map { "\($0.shift)@\(String(format: "%.2f", $0.score))" } ?? "none"
        let leadingVotes = scored.first.map { Int(votes[$0.shift + maxShift]) } ?? 0
        attempt = "max \(maxShift) best \(leading)/\(leadingVotes)v next \(scored.dropFirst().first.map { String(format: "%.2f", $0.score) } ?? "-") still \(String(format: "%.2f", bandStill))"
        guard let best = scored.first, best.score >= 0.3, best.score >= bandStill + 0.15 else { return nil }
        let second = scored.dropFirst().first { abs($0.shift - best.shift) > 2 }?.score ?? 0
        trace?("  relative \(best.shift) score \(String(format: "%.2f", best.score)) next \(String(format: "%.2f", second))")
        // 连续丢了几帧之后，上一帧多半已经过期（页面彻底变了），领先得少一点也可以找回来。
        let lead = lostStreak >= 3 ? 1.3 : 2
        return best.score >= 0.35 || lostStreak >= 3 ? (best.score >= lead * second ? best.shift : nil) : nil
    }

    /// 帧里某一块最常见的像素，稀疏采样。
    private func commonPixel(_ base: UnsafeRawPointer, bytesPerRow: Int, columns: Range<Int>, rows: Range<Int>) -> UInt32 {
        var counts: [UInt32: Int] = [:]
        var y = rows.lowerBound
        while y < rows.upperBound {
            let row = (base + y * bytesPerRow).assumingMemoryBound(to: UInt32.self)
            var x = columns.lowerBound
            while x < columns.upperBound {
                counts[row[x], default: 0] += 1
                x += 4
            }
            y += 4
        }
        return counts.max { $0.value < $1.value }?.key ?? 0xFFFF_FFFF
    }

    /// 中间部分滚了 `shift` 行时，完全留在原地的列段，比如吸顶侧栏。
    private func stillSegments(_ previous: Analysis, _ current: Analysis, shift: Int, top: Int, bottom: Int) -> [Bool] {
        let segments = Self.segments
        var stayed = [Int](repeating: 0, count: segments)
        var moved = [Int](repeating: 0, count: segments)
        var y = top
        while y < bottom {
            let row = y + shift
            for segment in 0..<segments where current.segmentDetailed[y * segments + segment] {
                let hash = current.segmentHashes[y * segments + segment]
                if previous.segmentHashes[y * segments + segment] == hash { stayed[segment] += 1 }
                if row >= top && row < bottom && previous.segmentHashes[row * segments + segment] == hash { moved[segment] += 1 }
            }
            y += 2
        }
        var still = (0..<segments).map { stayed[$0] >= 6 && stayed[$0] > 2 * moved[$0] }
        // 夹在两个不动列段之间的纯色段属于同一列。
        for segment in 1..<(segments - 1) where still[segment - 1] && still[segment + 1] { still[segment] = true }
        // 所有列都不动，说明是页面没滚。
        return still.allSatisfy { $0 } ? [Bool](repeating: false, count: segments) : still
    }

    /// 精确匹配的列段给它们之间的位移投票，包括 0。只有带细节、在中间部分里至多出现几次的列段参与。
    private func segmentVotes(_ previous: Analysis, _ current: Analysis, top: Int, bottom: Int, maxShift: Int) -> [Int32] {
        let segments = Self.segments
        var rowsByHash: [UInt64: [Int32]] = [:]
        rowsByHash.reserveCapacity((bottom - top) * 4)
        for y in top..<bottom {
            for segment in 0..<segments where previous.segmentDetailed[y * segments + segment] && !stillColumns[segment] {
                rowsByHash[previous.segmentHashes[y * segments + segment], default: []].append(Int32(y))
            }
        }
        var votes = [Int32](repeating: 0, count: 2 * maxShift + 1)
        for y in top..<bottom {
            for segment in 0..<segments where current.segmentDetailed[y * segments + segment] && !stillColumns[segment] {
                guard let rows = rowsByHash[current.segmentHashes[y * segments + segment]], rows.count <= 3 else {
                    continue
                }
                for row in rows {
                    let shift = Int(row) - y
                    if abs(shift) <= maxShift { votes[shift + maxShift] += 1 }
                }
            }
        }
        return votes
    }

    /// 给从不出现完全相同的行的内容（缩放过或重新渲染的文字）用：粗略的行轮廓最吻合的几个位移。
    private func profileShifts(
        _ previous: Analysis, _ current: Analysis, top: Int, bottom: Int, maxShift: Int
    ) -> [Int] {
        let bands = Self.profileBands
        var costs = [Double](repeating: .infinity, count: 2 * maxShift + 1)
        previous.profile.withUnsafeBufferPointer { first in
            current.profile.withUnsafeBufferPointer { second in
                for shift in -maxShift...maxShift where shift != 0 {
                    let from = max(top, top - shift)
                    let to = min(bottom, bottom - shift)
                    var total: Int64 = 0
                    var rows = 0
                    var y = from
                    while y < to {
                        let a = (y + shift) * bands
                        let b = y * bands
                        for band in 0..<bands { total += Int64(abs(first[a + band] - second[b + band])) }
                        rows += 1
                        y += 2
                    }
                    if rows > 0 { costs[shift + maxShift] = Double(total) / Double(rows) }
                }
            }
        }
        var minima: [(shift: Int, cost: Double)] = []
        for index in costs.indices where costs[index].isFinite {
            let left = index > 0 ? costs[index - 1] : .infinity
            let right = index + 1 < costs.count ? costs[index + 1] : .infinity
            if costs[index] <= left && costs[index] <= right { minima.append((index - maxShift, costs[index])) }
        }
        minima.sort { $0.cost < $1.cost }
        return minima.prefix(3).map(\.shift)
    }

    /// `from..<to` 行里（隔行取样）有细节的列段在位移 `shift` 下对得上的比例；
    /// 有细节的太少、判断不了时返回 nil。比例已经不可能达到 `need` 时提前放弃，返回 nil。
    private func score(
        _ previous: Analysis, _ current: Analysis, shift: Int, from: Int, to: Int, need: Double = 0
    ) -> Double? {
        let low = max(from, from - shift)
        let high = min(to, to - shift)
        guard high > low else { return nil }
        let segments = Self.segments
        var total = 0
        var y = low
        while y < high {
            let row = y + shift
            for segment in 0..<segments
            where !stillColumns[segment]
                && (current.segmentDetailed[y * segments + segment] || previous.segmentDetailed[row * segments + segment])
            {
                total += 1
            }
            y += 2
        }
        guard total >= 24 else { return nil }
        let allowedMisses = need > 0 ? Int(Double(total) * (1 - need)) : total
        var misses = 0
        y = low
        while y < high {
            let row = y + shift
            if previous.hashes[row] != current.hashes[y] {
                for segment in 0..<segments
                where !stillColumns[segment]
                    && (current.segmentDetailed[y * segments + segment] || previous.segmentDetailed[row * segments + segment])
                {
                    if !segmentMatches(previous, row, current, y, segment) {
                        misses += 1
                        if misses > allowedMisses { return nil }
                    }
                }
            }
            y += 2
        }
        return Double(total - misses) / Double(total)
    }
}
