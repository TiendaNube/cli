import { getCliExecutableName } from "../../cli-executable-name";
import { type SkillsAgent, detectInstalledAgents } from "./skills-agents";

/**
 * The line `--help` adds about the bundled skills.
 *
 * Help is the one place a suggestion costs nothing: it is printed only when
 * somebody asked for it, so naming the agents found on this machine here is
 * discovery rather than interruption.
 */

/** `Claude Code`, `Claude Code and Cursor`, `Claude Code, Cursor and Codex`. */
export function formatAgentList(agents: SkillsAgent[]): string {
	const names = agents.map((agent) => agent.displayName);
	if (names.length <= 1) {
		return names.join("");
	}
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Empty when the machine has no agent to serve — a suggestion nobody can act on
 * is just noise in an already long help screen.
 */
export function skillsHelpFooter(
	detect: () => SkillsAgent[] = detectInstalledAgents,
	binary: () => string = getCliExecutableName,
): string {
	let agents: SkillsAgent[];
	try {
		agents = detect();
	} catch {
		return "";
	}
	if (agents.length === 0) {
		return "";
	}
	return [
		"",
		`Agent Skills: detected ${formatAgentList(agents)} on this machine.`,
		`Run \`${binary()} skills install\` to teach them how Nuvemshop/Tiendanube themes work.`,
	].join("\n");
}
