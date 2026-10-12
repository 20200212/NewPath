import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureAgent, parseAgentEvent, parseAgentLine, splitLines, type AgentEvent } from "./captureAgent";

// 代替 Swift 截图进程：回显请求，slow 不回答，crash 直接退出
const FAKE_AGENT = `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	if (request.cmd === "slow") return;
	if (request.cmd === "crash") process.exit(3);
	if (request.cmd === "tick") process.stdout.write(JSON.stringify({ event: "scroll", status: "capturing", height: 900 }) + "\\n");
	process.stdout.write(JSON.stringify({ id: request.id, ok: true, echo: request.cmd }) + "\\n");
});
`;

const fakeSpawn = (() =>
	spawn(process.execPath, ["-e", FAKE_AGENT], { stdio: ["pipe", "pipe", "pipe"] })) as unknown as typeof spawn;

const agents: CaptureAgent[] = [];
function createAgent(events: string[] = []) {
	const agent = new CaptureAgent("fake", (event) => events.push(event), fakeSpawn);
	agents.push(agent);
	return agent;
}

afterEach(() => {
	for (const agent of agents.splice(0)) agent.stop();
});

describe("截图进程的协议解析", () => {
	it("只接受带整数 id 和 ok 的回答", () => {
		expect(parseAgentLine('{"id":3,"ok":true,"ms":12}')).toEqual({ id: 3, ok: true, ms: 12 });
		expect(parseAgentLine('{"id":"3","ok":true}')).toBeNull();
		expect(parseAgentLine('{"id":3}')).toBeNull();
		expect(parseAgentLine("not json")).toBeNull();
	});

	it("区分主动发来的事件和回答", () => {
		expect(parseAgentEvent('{"event":"scroll","status":"lost","height":1200}')).toEqual({
			event: "scroll",
			status: "lost",
			height: 1200,
		});
		expect(parseAgentEvent('{"id":3,"ok":true}')).toBeNull();
		expect(parseAgentEvent('{"id":3,"event":"scroll"}')).toBeNull();
		expect(parseAgentEvent('{"event":""}')).toBeNull();
		expect(parseAgentEvent("[1]")).toBeNull();
	});

	it("不完整的一行留到下次", () => {
		const first = splitLines("", '{"id":1,"ok":true}\n{"id":2,');
		expect(first).toEqual({ lines: ['{"id":1,"ok":true}'], rest: '{"id":2,' });
		expect(splitLines(first.rest, '"ok":false}\n')).toEqual({ lines: ['{"id":2,"ok":false}'], rest: "" });
	});
});

describe("CaptureAgent", () => {
	it("按 id 对上请求和回答", async () => {
		const agent = createAgent();
		const [a, b] = await Promise.all([
			agent.request({ cmd: "windows" }, 5000),
			agent.request({ cmd: "display" }, 5000),
		]);
		expect(a).toMatchObject({ ok: true, echo: "windows" });
		expect(b).toMatchObject({ ok: true, echo: "display" });
	});

	it("请求超时后放弃并重启进程", async () => {
		const events: string[] = [];
		const agent = createAgent(events);
		expect(await agent.request({ cmd: "slow" }, 150)).toBeNull();
		expect(events).toContain("capture-agent-timeout");
		expect(await agent.request({ cmd: "windows" }, 5000)).toMatchObject({ ok: true });
	});

	it("进程退出时未完成的请求都返回 null", async () => {
		const events: string[] = [];
		const agent = createAgent(events);
		expect(await agent.request({ cmd: "crash" }, 5000)).toBeNull();
		expect(events).toContain("capture-agent-stopped");
		expect(await agent.request({ cmd: "windows" }, 5000)).toMatchObject({ ok: true });
	});

	it("转发事件，进程退出时发出 stopped", async () => {
		const agent = createAgent();
		const received: AgentEvent[] = [];
		agent.onEvent((event) => received.push(event));
		expect(await agent.request({ cmd: "tick" }, 5000)).toMatchObject({ ok: true });
		expect(received).toEqual([{ event: "scroll", status: "capturing", height: 900 }]);
		expect(await agent.request({ cmd: "crash" }, 5000)).toBeNull();
		expect(received.at(-1)).toEqual({ event: "stopped" });
	});
});
