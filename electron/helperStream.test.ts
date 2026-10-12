import { describe, expect, it } from "vitest";
import { HelperStreamParser, parseFrameHeader } from "./helperStream";

function frameBytes(seq: number, width: number, height: number, fill: number) {
	const pixels = Buffer.alloc(width * height * 4, fill);
	return { header: Buffer.from(`frame ${seq} ${width} ${height} ${pixels.length}\n`), pixels };
}

describe("parseFrameHeader", () => {
	it("只接受格式正确的帧头", () => {
		expect(parseFrameHeader("frame 3 4 2 32")).toEqual({ seq: 3, width: 4, height: 2, bytes: 32 });
		expect(parseFrameHeader("frame 3 4 2")).toBeNull();
		expect(parseFrameHeader("frame 3 4 2 31")).toBeNull();
		expect(parseFrameHeader("frame -1 4 2 32")).toBeNull();
		expect(parseFrameHeader("frame 1 0 2 32")).toBeNull();
		expect(parseFrameHeader("frames 1 4 2 32")).toBeNull();
		expect(parseFrameHeader("12 ok")).toBeNull();
	});
});

describe("HelperStreamParser", () => {
	it("一次喂入完整的文本行和帧", () => {
		const parser = new HelperStreamParser();
		const { header, pixels } = frameBytes(1, 2, 2, 7);
		const messages = parser.push(Buffer.concat([Buffer.from("ready\n"), header, pixels, Buffer.from("5 ok\n")]));
		expect(messages.map((message) => message.kind)).toEqual(["line", "frame", "line"]);
		expect(messages[0]).toEqual({ kind: "line", text: "ready" });
		const frame = messages[1];
		if (frame.kind !== "frame") throw new Error("应是帧");
		expect(frame).toMatchObject({ seq: 1, width: 2, height: 2 });
		expect(frame.data.byteLength).toBe(16);
		expect(new Uint8Array(frame.data).every((byte) => byte === 7)).toBe(true);
		expect(messages[2]).toEqual({ kind: "line", text: "5 ok" });
	});

	it("帧头和帧体都可以跨多个 chunk", () => {
		const parser = new HelperStreamParser();
		const { header, pixels } = frameBytes(9, 3, 1, 1);
		const all = Buffer.concat([header, pixels, Buffer.from("tail\n")]);
		const messages = [];
		for (let i = 0; i < all.length; i += 5) messages.push(...parser.push(all.subarray(i, Math.min(all.length, i + 5))));
		expect(messages.length).toBe(2);
		expect(messages[0]).toMatchObject({ kind: "frame", seq: 9, width: 3, height: 1 });
		if (messages[0].kind === "frame") expect(messages[0].data.byteLength).toBe(12);
		expect(messages[1]).toEqual({ kind: "line", text: "tail" });
	});

	it("字节不够时暂存，不会把帧体当文本", () => {
		const parser = new HelperStreamParser();
		const { header, pixels } = frameBytes(2, 2, 1, 0x0a);
		expect(parser.push(header)).toEqual([]);
		expect(parser.push(pixels.subarray(0, 5))).toEqual([]);
		const messages = parser.push(pixels.subarray(5));
		expect(messages.length).toBe(1);
		expect(messages[0].kind).toBe("frame");
	});

	it("帧里的像素被拷进独立的 ArrayBuffer", () => {
		const parser = new HelperStreamParser();
		const { header, pixels } = frameBytes(1, 1, 1, 200);
		const [frame] = parser.push(Buffer.concat([header, pixels]));
		if (frame.kind !== "frame") throw new Error("应是帧");
		pixels.fill(0);
		expect(new Uint8Array(frame.data)[0]).toBe(200);
		expect(new Uint8Array(frame.data).byteOffset).toBe(0);
	});

	it("忽略空行和 CRLF 的回车", () => {
		const parser = new HelperStreamParser();
		expect(parser.push(Buffer.from("\r\n1 ok\r\n\n"))).toEqual([{ kind: "line", text: "1 ok" }]);
	});

	it("reset 丢掉半截数据", () => {
		const parser = new HelperStreamParser();
		const { header } = frameBytes(1, 2, 2, 0);
		parser.push(header);
		parser.reset();
		expect(parser.push(Buffer.from("2 ok\n"))).toEqual([{ kind: "line", text: "2 ok" }]);
	});
});
