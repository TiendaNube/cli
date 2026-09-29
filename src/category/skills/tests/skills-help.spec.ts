import { describe, expect, it } from "vitest";
import type { SkillsAgent } from "../skills-agents";
import { formatAgentList, skillsHelpFooter } from "../skills-help";

function agent(name: string, displayName: string): SkillsAgent {
	return {
		name,
		displayName,
		projectDir: ".agents/skills",
		GlobalDir: () => "/nowhere",
		IsInstalled: () => true,
	};
}

const claude = agent("claude-code", "Claude Code");
const cursor = agent("cursor", "Cursor");
const codex = agent("codex", "Codex");

describe("formatAgentList", () => {
	it("reads like a sentence", () => {
		expect(formatAgentList([])).toBe("");
		expect(formatAgentList([claude])).toBe("Claude Code");
		expect(formatAgentList([claude, cursor])).toBe("Claude Code and Cursor");
		expect(formatAgentList([claude, cursor, codex])).toBe(
			"Claude Code, Cursor and Codex",
		);
	});
});

describe("the help footer", () => {
	it("names the agents found and the command to run", () => {
		const footer = skillsHelpFooter(
			() => [claude, cursor],
			() => "nuvemshop",
		);
		expect(footer).toContain("Claude Code and Cursor");
		expect(footer).toContain("`nuvemshop skills install`");
	});

	it("mirrors the binary the user invoked", () => {
		expect(
			skillsHelpFooter(
				() => [claude],
				() => "tiendanube",
			),
		).toContain("`tiendanube skills install`");
	});

	it("stays empty when no agent could use the skills", () => {
		expect(
			skillsHelpFooter(
				() => [],
				() => "nuvemshop",
			),
		).toBe("");
	});

	it("stays empty rather than breaking help when detection fails", () => {
		expect(
			skillsHelpFooter(
				() => {
					throw new Error("fs exploded");
				},
				() => "nuvemshop",
			),
		).toBe("");
	});
});
