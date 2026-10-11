import { describe, expect, it } from "vitest";
import { findSensitiveRanges, findSensitiveRegions, type Identity } from "./sensitiveText";

const noIdentity: Identity = { userNames: [], hostNames: [] };

/** 返回命中的文本和类型，方便断言。 */
function hits(text: string, identity = noIdentity) {
	return findSensitiveRanges(text, identity).map((range) => [text.slice(range.start, range.end), range.kind]);
}

describe("findSensitiveRanges", () => {
	it("识别终端提示符里的用户名和主机名", () => {
		expect(hits("alice@devbox:~$ ls")).toEqual([
			["alice", "username"],
			["devbox", "hostname"],
		]);
		expect(hits("git@github.com:me/repo.git")).toEqual([]);
	});

	it("识别邮箱，跳过 git@", () => {
		expect(hits("联系 zhang.san@example.com 获取")).toEqual([["zhang.san@example.com", "email"]]);
	});

	it("识别用户目录，跳过公共目录", () => {
		expect(hits(String.raw`C:\Users\Bob\Desktop`)).toEqual([["Bob", "username"]]);
		expect(hits("/home/carol/.ssh")).toEqual([["carol", "username"]]);
		expect(hits(String.raw`C:\Users\Public\Music`)).toEqual([]);
	});

	it("识别 IPv4，排除回环和非法地址", () => {
		expect(hits("server 10.0.12.5 ok")).toEqual([["10.0.12.5", "ip"]]);
		expect(hits("127.0.0.1 0.0.0.0 300.1.1.1")).toEqual([]);
		expect(hits("version 1.2.3.4.5")).toEqual([]);
	});

	it("识别 IPv6 和 MAC，不把时间当成地址", () => {
		expect(hits("addr fe80::1ff:fe23:4567:890a")).toEqual([["fe80::1ff:fe23:4567:890a", "ip"]]);
		expect(hits("mac 00:1A:2b:3C:4d:5E")).toEqual([["00:1A:2b:3C:4d:5E", "mac"]]);
		expect(hits("at 14:02:11 done")).toEqual([]);
	});

	it("识别常见密钥前缀和配置项的值", () => {
		expect(hits("OPENAI=sk-abcdefghijklmnop1234")).toEqual([["sk-abcdefghijklmnop1234", "secret"]]);
		expect(hits('api_key: "abcd1234efgh"')).toEqual([["abcd1234efgh", "secret"]]);
		expect(hits("password=$DB_PASS")).toEqual([]);
		expect(hits("password: ********")).toEqual([]);
		expect(hits("curl --token abcdef123456")).toEqual([["abcdef123456", "secret"]]);
		expect(hits("Authorization: Bearer abc.def-ghi_jkl")).toEqual([["abc.def-ghi_jkl", "secret"]]);
	});

	it("识别手机号和身份证号", () => {
		expect(hits("电话 138 1234 5678")).toEqual([["138 1234 5678", "phone"]]);
		expect(hits("tel:13812345678")).toEqual([["13812345678", "phone"]]);
		expect(hits("身份证 11010519491231002X")).toEqual([["11010519491231002X", "id-card"]]);
		expect(hits("订单号 123456789012345678")).toEqual([]);
	});

	it("识别本机用户名、主机名，太短的名字不单独匹配", () => {
		const identity = { userNames: ["Administrator", "ab"], hostNames: ["DESKTOP-X1"] };
		expect(hits("登录用户 administrator 在 DESKTOP-X1 上", identity)).toEqual([
			["administrator", "username"],
			["DESKTOP-X1", "hostname"],
		]);
		expect(hits("ab cd", identity)).toEqual([]);
	});
});

describe("findSensitiveRegions", () => {
	it("按字符位置截取词内的区域，并适当外扩", () => {
		const lines = [
			{
				text: "ip=10.0.0.8",
				words: [{ text: "ip=10.0.0.8", x: 0, y: 100, width: 110, height: 20 }],
			},
		];
		const [region] = findSensitiveRegions(lines, noIdentity);
		// "ip=" 占 3/11，外扩 0.15 × 20 = 3px
		expect(region.kind).toBe("ip");
		expect(region.x).toBe(27);
		expect(region.width).toBe(86);
		expect(region.y).toBe(97);
		expect(region.height).toBe(26);
	});

	it("中文单字拆成多个词时也能定位，结果限制在图片内", () => {
		const words = ["电", "话", "13812345678"].map((text, index) => ({
			text,
			x: index * 20,
			y: 0,
			width: index < 2 ? 20 : 110,
			height: 20,
		}));
		const regions = findSensitiveRegions([{ text: "", words }], noIdentity, { width: 140, height: 22 });
		expect(regions).toEqual([{ x: 37, y: 0, width: 103, height: 22, kind: "phone" }]);
	});
});
