import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** One coding agent the bundled skills can be installed into. */
export type SkillsAgent = {
	/** Value accepted by `--agent`. */
	name: string;
	displayName: string;
	/** Skills directory inside a project, relative to the workspace root. */
	projectDir: string;
	/** Absolute skills directory for a machine-wide install. */
	GlobalDir(): string;
	/** Whether this agent looks installed on this machine. */
	IsInstalled(): boolean;
};

function home(): string {
	return os.homedir();
}

/** `$XDG_CONFIG_HOME`, else `~/.config` — what OpenCode, Amp and Goose follow. */
function configHome(): string {
	const configured = process.env.XDG_CONFIG_HOME?.trim();
	return configured !== undefined && configured !== ""
		? configured
		: path.join(home(), ".config");
}

/** `CLAUDE_CONFIG_DIR` moves Claude Code's whole config tree, skills included. */
function claudeHome(): string {
	const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
	return configured !== undefined && configured !== ""
		? configured
		: path.join(home(), ".claude");
}

/** `CODEX_HOME` plays the same role for Codex. */
function codexHome(): string {
	const configured = process.env.CODEX_HOME?.trim();
	return configured !== undefined && configured !== ""
		? configured
		: path.join(home(), ".codex");
}

/** OpenClaw kept its two former names; whichever exists is the live one. */
function openClawHome(): string {
	for (const candidate of [".openclaw", ".clawdbot", ".moltbot"]) {
		if (directoryExists(path.join(home(), candidate))) {
			return path.join(home(), candidate);
		}
	}
	return path.join(home(), ".openclaw");
}

function directoryExists(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

function anyDirectoryExists(candidates: string[]): boolean {
	return candidates.some(directoryExists);
}

type DirectoryAgentSpec = {
	name: string;
	displayName: string;
	projectDir: string;
	global: () => string;
	detect: () => boolean;
};

function directoryAgent(spec: DirectoryAgentSpec): SkillsAgent {
	return {
		name: spec.name,
		displayName: spec.displayName,
		projectDir: spec.projectDir,
		GlobalDir: spec.global,
		IsInstalled: spec.detect,
	};
}

/** Shorthand for the majority shape: `.agents/skills` in a project, one dir at home. */
function homeAgent(
	name: string,
	displayName: string,
	directory: string,
	options: { projectDir?: string; detect?: string[] } = {},
): SkillsAgent {
	return directoryAgent({
		name,
		displayName,
		projectDir: options.projectDir ?? path.join(".agents", "skills"),
		global: () => path.join(home(), directory, "skills"),
		detect: () =>
			anyDirectoryExists(
				(options.detect ?? [directory]).map((candidate) =>
					path.join(home(), candidate),
				),
			),
	});
}

/**
 * The clients this command knows how to install into.
 *
 * Paths and detection follow the Agent Skills reference implementation
 * (github.com/vercel-labs/skills, `src/agents.ts`), which is the same table the
 * npm-convention installer vendors. It lists ~80 clients; this is the subset
 * that a Nuvemshop/Tiendanube theme developer plausibly runs, and `--agent`
 * plus a new row here is all it takes to add another.
 *
 * Several clients share `.agents/skills` at project scope on purpose — the
 * install deduplicates destinations rather than writing one folder repeatedly.
 */
export const SKILLS_AGENTS: SkillsAgent[] = [
	// Covers Claude Code wherever it runs: the terminal and the desktop app's
	// Code tab are the same client reading the same directory.
	directoryAgent({
		name: "claude-code",
		displayName: "Claude Code",
		projectDir: path.join(".claude", "skills"),
		global: () => path.join(claudeHome(), "skills"),
		detect: () => directoryExists(claudeHome()),
	}),
	directoryAgent({
		name: "cursor",
		displayName: "Cursor",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".cursor", "skills"),
		detect: () => directoryExists(path.join(home(), ".cursor")),
	}),
	directoryAgent({
		name: "codex",
		displayName: "Codex",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(codexHome(), "skills"),
		detect: () => directoryExists(codexHome()),
	}),
	homeAgent("gemini-cli", "Gemini CLI", ".gemini", {
		detect: [".gemini"],
	}),
	directoryAgent({
		name: "antigravity",
		displayName: "Antigravity",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".gemini", "antigravity", "skills"),
		detect: () => directoryExists(path.join(home(), ".gemini", "antigravity")),
	}),
	homeAgent("github-copilot", "GitHub Copilot", ".copilot"),
	directoryAgent({
		name: "openclaw",
		displayName: "OpenClaw",
		projectDir: "skills",
		global: () => path.join(openClawHome(), "skills"),
		detect: () =>
			anyDirectoryExists([
				path.join(home(), ".openclaw"),
				path.join(home(), ".clawdbot"),
				path.join(home(), ".moltbot"),
			]),
	}),
	directoryAgent({
		name: "pi",
		displayName: "Pi",
		projectDir: path.join(".pi", "skills"),
		global: () => path.join(home(), ".pi", "agent", "skills"),
		detect: () => directoryExists(path.join(home(), ".pi", "agent")),
	}),
	directoryAgent({
		name: "windsurf",
		displayName: "Windsurf",
		projectDir: path.join(".windsurf", "skills"),
		global: () => path.join(home(), ".codeium", "windsurf", "skills"),
		detect: () => directoryExists(path.join(home(), ".codeium", "windsurf")),
	}),
	directoryAgent({
		name: "zed",
		displayName: "Zed",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".agents", "skills"),
		detect: () => directoryExists(path.join(configHome(), "zed")),
	}),
	directoryAgent({
		name: "opencode",
		displayName: "OpenCode",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(configHome(), "opencode", "skills"),
		detect: () => directoryExists(path.join(configHome(), "opencode")),
	}),
	directoryAgent({
		name: "cline",
		displayName: "Cline",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".agents", "skills"),
		detect: () => directoryExists(path.join(home(), ".cline")),
	}),
	directoryAgent({
		name: "warp",
		displayName: "Warp",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".agents", "skills"),
		detect: () => directoryExists(path.join(home(), ".warp")),
	}),
	directoryAgent({
		name: "droid",
		displayName: "Droid",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(home(), ".factory", "skills"),
		detect: () => directoryExists(path.join(home(), ".factory")),
	}),
	homeAgent("kilo", "Kilo Code", ".kilo", { detect: [".kilo", ".kilocode"] }),
	homeAgent("roo", "Roo Code", ".roo", {
		projectDir: path.join(".roo", "skills"),
	}),
	homeAgent("continue", "Continue", ".continue", {
		projectDir: path.join(".continue", "skills"),
	}),
	homeAgent("junie", "Junie", ".junie", {
		projectDir: path.join(".junie", "skills"),
	}),
	homeAgent("augment", "Augment", ".augment", {
		projectDir: path.join(".augment", "skills"),
	}),
	homeAgent("trae", "Trae", ".trae", {
		projectDir: path.join(".trae", "skills"),
	}),
	homeAgent("qwen-code", "Qwen Code", ".qwen", {
		projectDir: path.join(".qwen", "skills"),
	}),
	homeAgent("openhands", "OpenHands", ".openhands", {
		projectDir: path.join(".openhands", "skills"),
	}),
	homeAgent("kiro-cli", "Kiro CLI", ".kiro", {
		projectDir: path.join(".kiro", "skills"),
	}),
	directoryAgent({
		name: "goose",
		displayName: "Goose",
		projectDir: path.join(".goose", "skills"),
		global: () => path.join(configHome(), "goose", "skills"),
		detect: () => directoryExists(path.join(configHome(), "goose")),
	}),
	directoryAgent({
		name: "amp",
		displayName: "Amp",
		projectDir: path.join(".agents", "skills"),
		global: () => path.join(configHome(), "agents", "skills"),
		detect: () => directoryExists(path.join(configHome(), "amp")),
	}),
	directoryAgent({
		name: "crush",
		displayName: "Crush",
		projectDir: path.join(".crush", "skills"),
		global: () => path.join(configHome(), "crush", "skills"),
		detect: () => directoryExists(path.join(configHome(), "crush")),
	}),
];

export function findAgent(name: string): SkillsAgent | undefined {
	return SKILLS_AGENTS.find((agent) => agent.name === name);
}

export function agentNames(): string[] {
	return SKILLS_AGENTS.map((agent) => agent.name);
}

export function detectInstalledAgents(): SkillsAgent[] {
	return SKILLS_AGENTS.filter((agent) => agent.IsInstalled());
}

export type SkillsScope = "global" | "project";

/** One directory to install into, plus every agent that reads it. */
export type SkillsDestination = {
	agents: string[];
	path: string;
};

/**
 * Resolves the directories to write, collapsing the agents that share one.
 *
 * At project scope many clients read `.agents/skills`, so without the collapse
 * the same folder would be planned, reported and confirmed once per client.
 */
export function resolveDestinations(options: {
	agents: SkillsAgent[];
	scope: SkillsScope;
	cwd: string;
}): SkillsDestination[] {
	const byKey = new Map<string, SkillsDestination>();
	for (const agent of options.agents) {
		const target =
			options.scope === "global"
				? path.resolve(agent.GlobalDir())
				: path.resolve(options.cwd, agent.projectDir);
		const existing = byKey.get(target);
		if (existing === undefined) {
			byKey.set(target, { agents: [agent.name], path: target });
			continue;
		}
		existing.agents.push(agent.name);
	}
	return [...byKey.values()];
}
