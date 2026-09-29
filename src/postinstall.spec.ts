import { describe, expect, it, vi } from "vitest";
import type { SkillsAgent } from "./category/skills/skills-agents";
import { buildPostinstallMessage, runPostinstall } from "./postinstall";

function agent(name: string, displayName: string): SkillsAgent {
	return {
		name,
		displayName,
		projectDir: ".agents/skills",
		GlobalDir: () => "/nowhere",
		IsInstalled: () => true,
	};
}

const twoAgents = () => [
	agent("claude-code", "Claude Code"),
	agent("cursor", "Cursor"),
];

describe("the install-time suggestion", () => {
	it("names the agents it found and the command to run", () => {
		const message = buildPostinstallMessage({}, twoAgents);
		expect(message).toContain("Claude Code, Cursor");
		expect(message).toContain("nuvemshop skills install");
	});

	it("says nothing when no agent is on the machine", () => {
		expect(buildPostinstallMessage({}, () => [])).toBeNull();
	});

	it("says nothing in CI or under a test runner", () => {
		expect(buildPostinstallMessage({ CI: "1" }, twoAgents)).toBeNull();
		expect(buildPostinstallMessage({ CI: "true" }, twoAgents)).toBeNull();
		expect(buildPostinstallMessage({ VITEST: "1" }, twoAgents)).toBeNull();
		expect(buildPostinstallMessage({ NODE_ENV: "test" }, twoAgents)).toBeNull();
	});

	it("treats the empty and falsy CI values as not CI", () => {
		expect(buildPostinstallMessage({ CI: "" }, twoAgents)).not.toBeNull();
		expect(buildPostinstallMessage({ CI: "0" }, twoAgents)).not.toBeNull();
		expect(buildPostinstallMessage({ CI: "false" }, twoAgents)).not.toBeNull();
	});

	it("never throws, whatever detection does", () => {
		expect(() =>
			runPostinstall(() => {
				throw new Error("fs exploded");
			}),
		).not.toThrow();
	});

	it("writes the message when there is one", () => {
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		runPostinstall(() => "hello");
		expect(write).toHaveBeenCalledWith("\nhello\n");
		write.mockRestore();
	});
});
