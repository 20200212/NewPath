import Foundation

/// 把正在滚动的一块区域逐帧拼成一张长图。
///
/// 帧是 32 位 BGRA（与 ScreenCaptureKit 一致），每帧 `width × height` 像素。做法：
/// - 每帧先算出每一行、每个列段的哈希。新帧和“参照帧”（上一张拼进长图的帧）比较，
///   顶部、底部逐行完全相同的部分是不动的工具栏 / 页脚，不参与匹配；
/// - 中间部分里，参照帧中只出现一次的列段哈希当作锚点，新帧里哈希相同的列段给“滚动了几行”投票，
///   得票最多且明显领先的就是滚动量。按列段投票，一行里局部变化（悬停高亮、不跟着滚的侧栏）不影响其余部分；
/// - 投票失败时再按每段的亮度和做一次带容差的搜索，兜住整体颜色轻微变化的情况；
/// - 长图以第一帧为坐标原点：偏移为 s 的帧，第 r 行落在长图第 r + s 行。每张拼进来的帧都覆盖它显示的行，
///   所以每一行保留最后一次看到的样子（占位图换成加载好的图）；顶部栏来自第一帧，底部栏来自滚得最远的那一帧；
/// - 第一次向下滚动之前，一直以最新的一帧为起点：窗口激活后的变化、用户先往上滚到想要的起点，都不会被拼进去。
///
/// 纯逻辑，不依赖 ScreenCaptureKit，可以单独编译测试（见 tests/main.swift）。
final class ScrollStitcher {
    enum Outcome: Equatable {
        /// 画面没有滚动（可能有原地变化）。
        case unchanged
        /// 还没开始向下滚，这一帧成为新的起点。
        case waiting
        /// 长图增加了这么多行。
        case appended(Int)
        /// 往回滚到了已经拍过的地方。
        case behind
        /// 和参照帧找不到重叠（滚得太快，或者画面整个变了）。
        case lost
        /// 已经达到最大高度，之后的帧都不再处理。
        case full
    }

    let width: Int
    let height: Int
    let maxHeight: Int

    // 诊断用的统计
    private(set) var framesSeen = 0
    private(set) var framesLost = 0
    /// 连续丢失算一次。
    private(set) var lossEpisodes = 0
    /// 最长一次连续丢失了多少帧。
    private(set) var longestLoss = 0
    private var currentLoss = 0

    private let rowBytes: Int
    private let segments: Int
    /// 各列段的起始列，最后一项是参与匹配的列数（右侧忽略的列不算）。
    private let segmentStarts: [Int]
    private let canvas: RowStore

    private var anchor: Features?
    /// 参照帧在长图里的偏移。
    private var anchorOffset = 0
    /// 拼进来的帧里偏移最大的那个。
    private var maxOffset = 0
    /// 偏移最大的那一帧的完整像素，结束时用它的底部栏。
    private var bottomFrame: [UInt8]
    /// bottomFrame 拼进来时，底部有多少行没有画进长图（当时估计的底部栏高度）。
    private var bottomFrameFooter = 0
    private var started = false
    private var isFull = false
    /// 顶部 / 底部固定不动的行数；第一次检测到滚动之前未知。只会变小。
    private var header: Int?
    private var footer: Int?

    /// - Parameter ignoredRight: 右侧不参与匹配的列数，用来避开滚动时才出现的浮动滚动条。
    init(width: Int, height: Int, maxHeight: Int, ignoredRight: Int = 0) {
        precondition(width > 0 && height > 0)
        self.width = width
        self.height = height
        self.maxHeight = max(height, maxHeight)
        rowBytes = width * 4
        let matched = max(1, width - max(0, ignoredRight))
        let count = max(1, min(8, matched / 16))
        segments = count
        segmentStarts = (0...count).map { $0 * matched / count }
        canvas = RowStore(rowBytes: width * 4)
        bottomFrame = [UInt8](repeating: 0, count: width * height * 4)
    }

    /// 现在结束的话长图有多高。
    var projectedHeight: Int {
        framesSeen == 0 ? 0 : min(maxHeight, height + maxOffset)
    }

    /// 加入一帧。`base` 指向第一行，每行 `bytesPerRow` 字节（不小于 width * 4）。
    func add(_ base: UnsafeRawPointer, bytesPerRow: Int) -> Outcome {
        if isFull { return .full }
        framesSeen += 1
        let current = Features(base, bytesPerRow: bytesPerRow, height: height, segmentStarts: segmentStarts)
        guard let reference = anchor else {
            restart(base, bytesPerRow: bytesPerRow, features: current)
            return .waiting
        }

        // 顶部、底部逐行相同的部分
        var top = 0
        while top < height && reference.rowHash[top] == current.rowHash[top] { top += 1 }
        if top == height { return .unchanged }
        var bottom = height
        while bottom > top && reference.rowHash[bottom - 1] == current.rowHash[bottom - 1] { bottom -= 1 }

        guard let shift = findShift(reference, current, top: top, bottom: bottom) else {
            // 只有一小块变了又对不上：多半是图片加载、动画这类原地变化
            if bottom - top <= height * 35 / 100 {
                resetLoss()
                return inPlace(base, bytesPerRow: bytesPerRow, features: current)
            }
            framesLost += 1
            currentLoss += 1
            if currentLoss == 1 { lossEpisodes += 1 }
            longestLoss = max(longestLoss, currentLoss)
            return .lost
        }
        resetLoss()
        if shift == 0 { return inPlace(base, bytesPerRow: bytesPerRow, features: current) }

        // 滚动过的两帧里，顶部、底部相同的行才可能是固定栏；取历次的最小值
        header = min(header ?? top, top, height / 2)
        footer = min(footer ?? (height - bottom), height - bottom, height / 2)
        if !started {
            if shift < 0 {
                restart(base, bytesPerRow: bytesPerRow, features: current)
                return .waiting
            }
            started = true
        }

        let before = projectedHeight
        let previousMax = maxOffset
        let offset = anchorOffset + shift
        place(base, bytesPerRow: bytesPerRow, features: current, offset: offset)
        if projectedHeight >= maxHeight {
            isFull = true
            return .full
        }
        if offset > previousMax { return .appended(projectedHeight - before) }
        return .behind
    }

    /// 拼好的长图：BGRA，每行 width * 4 字节。一帧都没有时返回 nil。
    func finish() -> (pixels: [UInt8], rows: Int)? {
        let rows = projectedHeight
        guard rows > 0 else { return nil }
        return (compose(0..<rows), rows)
    }

    /// 长图最下面（最新）的至多 `count` 行，给实时预览用。
    func newestRows(_ count: Int) -> (pixels: [UInt8], rows: Int) {
        let total = projectedHeight
        let rows = max(0, min(count, total))
        return (compose((total - rows)..<total), rows)
    }

    // MARK: - 拼接

    private func resetLoss() {
        currentLoss = 0
    }

    /// 以这一帧为起点重新开始。
    private func restart(_ base: UnsafeRawPointer, bytesPerRow: Int, features: Features) {
        canvas.removeAll()
        anchor = features
        anchorOffset = 0
        maxOffset = 0
        paint(base, bytesPerRow: bytesPerRow, rows: 0..<height, offset: 0, floor: 0)
        keepBottomFrame(base, bytesPerRow: bytesPerRow, footer: footer ?? 0)
    }

    /// 没有滚动但内容变了：等待阶段直接换成新起点，开始后按原位置覆盖。
    private func inPlace(_ base: UnsafeRawPointer, bytesPerRow: Int, features: Features) -> Outcome {
        if !started {
            restart(base, bytesPerRow: bytesPerRow, features: features)
            return .waiting
        }
        place(base, bytesPerRow: bytesPerRow, features: features, offset: anchorOffset)
        return .unchanged
    }

    private func place(_ base: UnsafeRawPointer, bytesPerRow: Int, features: Features, offset: Int) {
        let top = header ?? 0
        let bottom = footer ?? 0
        paint(base, bytesPerRow: bytesPerRow, rows: top..<(height - bottom), offset: offset, floor: top)
        anchor = features
        anchorOffset = offset
        if offset >= maxOffset {
            maxOffset = offset
            keepBottomFrame(base, bytesPerRow: bytesPerRow, footer: bottom)
        }
    }

    /// 把帧的 `rows` 画到长图 `offset` 处；长图里 `floor` 以上（顶部栏）和最大高度以下的行不画。
    private func paint(_ base: UnsafeRawPointer, bytesPerRow: Int, rows: Range<Int>, offset: Int, floor: Int) {
        for row in rows {
            let target = row + offset
            if target < floor { continue }
            if target >= maxHeight { break }
            canvas.row(target).copyMemory(from: base + row * bytesPerRow, byteCount: rowBytes)
        }
    }

    private func keepBottomFrame(_ base: UnsafeRawPointer, bytesPerRow: Int, footer: Int) {
        bottomFrameFooter = footer
        bottomFrame.withUnsafeMutableBytes { target in
            for row in 0..<height {
                (target.baseAddress! + row * rowBytes).copyMemory(from: base + row * bytesPerRow, byteCount: rowBytes)
            }
        }
    }

    /// 取长图的若干行：最后 bottomFrameFooter 行来自滚得最远的那一帧的底部，其余来自长图。
    private func compose(_ range: Range<Int>) -> [UInt8] {
        let total = projectedHeight
        let footerStart = total - bottomFrameFooter
        var pixels = [UInt8](repeating: 0, count: range.count * rowBytes)
        pixels.withUnsafeMutableBytes { buffer in
            bottomFrame.withUnsafeBytes { bottom in
                for (index, row) in range.enumerated() {
                    let target = buffer.baseAddress! + index * rowBytes
                    if row >= footerStart {
                        target.copyMemory(from: bottom.baseAddress! + (height - (total - row)) * rowBytes, byteCount: rowBytes)
                    } else {
                        target.copyMemory(from: canvas.row(row), byteCount: rowBytes)
                    }
                }
            }
        }
        return pixels
    }

    // MARK: - 找滚动量

    /// 新帧相对参照帧滚动了几行（正数为向下滚，内容上移）。只比较 [top, bottom) 之间的行。
    private func findShift(_ reference: Features, _ current: Features, top: Int, bottom: Int) -> Int? {
        voteShift(reference, current, top: top, bottom: bottom)
            ?? searchShift(reference, current, top: top, bottom: bottom)
    }

    private func voteShift(_ reference: Features, _ current: Features, top: Int, bottom: Int) -> Int? {
        // 只用两帧里都只出现一次的列段当锚点
        let anchors = uniqueSegments(reference, top: top, bottom: bottom)
        let candidates = uniqueSegments(current, top: top, bottom: bottom)
        var votes = [Int32](repeating: 0, count: 2 * height + 1)
        var found = 0
        for (key, row) in candidates where row >= 0 {
            guard let match = anchors[key], match >= 0 else { continue }
            votes[Int(match) - Int(row) + height] += 1
            found += 1
        }
        guard let best = votes.indices.max(by: { votes[$0] < votes[$1] }) else { return nil }
        let bestVotes = Int(votes[best])
        guard bestVotes >= max(6, found / 5) else { return nil }
        // 次多的票数（不算紧挨着的几个位移）要明显落后
        var second = 0
        for index in votes.indices where abs(index - best) > 2 { second = max(second, Int(votes[index])) }
        guard bestVotes >= second * 2 else { return nil }
        return best - height
    }

    /// [top, bottom) 之间每个非纯色列段的哈希 → 所在行；出现不止一次的记为 -1。
    /// 连续几行一模一样（文字的竖笔画、色块的左右边）时只记第一行：这几行彼此分不清，
    /// 都记下来会互相变成“重复”，或者把票分到相邻的几个位移上。
    private func uniqueSegments(_ features: Features, top: Int, bottom: Int) -> [UInt64: Int32] {
        var rows = [UInt64: Int32](minimumCapacity: (bottom - top) * segments)
        for row in top..<bottom {
            for segment in 0..<segments {
                let index = row * segments + segment
                if features.flat[index] { continue }
                let key = features.segmentHash[index]
                if row > top && features.segmentHash[index - segments] == key { continue }
                rows[key] = rows[key] == nil ? Int32(row) : -1
            }
        }
        return rows
    }

    /// 投票失败时的兜底：每段亮度和在容差内的行占多数的位移。
    private func searchShift(_ reference: Features, _ current: Features, top: Int, bottom: Int) -> Int? {
        let span = bottom - top
        let minimumOverlap = max(24, span / 4)
        guard span > minimumOverlap else { return nil }
        // 每个像素三个通道平均差不超过 8
        let tolerance = (0..<segments).map { (segmentStarts[$0 + 1] - segmentStarts[$0]) * 3 * 8 }
        let limit = span - minimumOverlap
        // 每个位移：容差内的行占比，以及平均差值（占比差不多时取差值最小的，免得差一两行）
        var scores = [Double](repeating: 0, count: 2 * limit + 1)
        var costs = [Double](repeating: .infinity, count: 2 * limit + 1)
        for shift in -limit...limit {
            var samples = 0
            var matched = 0
            var cost = 0
            var row = max(top, top - shift)
            let end = min(bottom, bottom - shift)
            while row < end {
                let other = row + shift
                if !(current.rowFlat[row] && reference.rowFlat[other]) {
                    samples += 1
                    var close = true
                    for segment in 0..<segments {
                        let difference = abs(
                            Int(current.bandSum[row * segments + segment]) - Int(reference.bandSum[other * segments + segment]))
                        cost += difference
                        if difference > tolerance[segment] { close = false }
                    }
                    if close { matched += 1 }
                }
                row += 3
            }
            if samples >= 8 {
                scores[shift + limit] = Double(matched) / Double(samples)
                costs[shift + limit] = Double(cost) / Double(samples)
            }
        }
        guard let peak = scores.indices.max(by: { scores[$0] < scores[$1] }), scores[peak] >= 0.8 else { return nil }
        var second = 0.0
        for index in scores.indices where abs(index - peak) > 3 { second = max(second, scores[index]) }
        guard second <= scores[peak] - 0.2 else { return nil }
        let nearby = max(0, peak - 3)...min(scores.count - 1, peak + 3)
        let best = nearby.filter { scores[$0] >= scores[peak] - 0.05 }.min { costs[$0] < costs[$1] } ?? peak
        return best - limit
    }
}

/// 一帧的特征：每行的哈希，以及每行每个列段的哈希、是否纯色、亮度和。
private struct Features {
    var rowHash: [UInt64]
    var rowFlat: [Bool]
    var segmentHash: [UInt64]
    var flat: [Bool]
    var bandSum: [Int32]

    init(_ base: UnsafeRawPointer, bytesPerRow: Int, height: Int, segmentStarts: [Int]) {
        let segments = segmentStarts.count - 1
        rowHash = [UInt64](repeating: 0, count: height)
        rowFlat = [Bool](repeating: true, count: height)
        segmentHash = [UInt64](repeating: 0, count: height * segments)
        flat = [Bool](repeating: true, count: height * segments)
        bandSum = [Int32](repeating: 0, count: height * segments)
        let basis: UInt64 = 0xcbf2_9ce4_8422_2325
        let prime: UInt64 = 0x0000_0100_0000_01b3
        for row in 0..<height {
            let line = base + row * bytesPerRow
            var whole = basis
            var rowIsFlat = true
            let rowFirst = line.loadUnaligned(as: UInt32.self) & 0x00ff_ffff
            for segment in 0..<segments {
                // 段号混进初值，不同列段的相同内容哈希不同
                var hash = basis ^ (UInt64(segment + 1) &* 0x9e37_79b9_7f4a_7c15)
                var sum: UInt32 = 0
                var same = true
                let first = line.loadUnaligned(fromByteOffset: segmentStarts[segment] * 4, as: UInt32.self) & 0x00ff_ffff
                for column in segmentStarts[segment]..<segmentStarts[segment + 1] {
                    // 小端 BGRA：低字节是 B，最高字节是 A（不参与比较）
                    let pixel = line.loadUnaligned(fromByteOffset: column * 4, as: UInt32.self) & 0x00ff_ffff
                    hash = (hash ^ UInt64(pixel)) &* prime
                    sum &+= (pixel & 0xff) &+ ((pixel >> 8) & 0xff) &+ (pixel >> 16)
                    same = same && pixel == first
                }
                let index = row * segments + segment
                segmentHash[index] = hash
                flat[index] = same
                bandSum[index] = Int32(truncatingIfNeeded: sum)
                rowIsFlat = rowIsFlat && same && first == rowFirst
                whole = (whole ^ hash) &* prime
            }
            rowHash[row] = whole
            rowFlat[row] = rowIsFlat
        }
    }
}

/// 按块分配的行存储，长图变高时不用整体搬家。
private final class RowStore {
    private static let chunkRows = 256
    private let rowBytes: Int
    private var chunks: [UnsafeMutableRawPointer] = []

    init(rowBytes: Int) {
        self.rowBytes = rowBytes
    }

    deinit {
        removeAll()
    }

    func removeAll() {
        for chunk in chunks { chunk.deallocate() }
        chunks.removeAll()
    }

    /// 第 `index` 行的起始地址；还没分配到的块会分配并清零。
    func row(_ index: Int) -> UnsafeMutableRawPointer {
        let chunk = index / Self.chunkRows
        while chunks.count <= chunk {
            let size = Self.chunkRows * rowBytes
            let memory = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 16)
            memory.initializeMemory(as: UInt8.self, repeating: 0, count: size)
            chunks.append(memory)
        }
        return chunks[chunk] + (index % Self.chunkRows) * rowBytes
    }
}
