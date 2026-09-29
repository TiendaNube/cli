import type { Command } from "commander";
import { SkillsInstallCommand } from "./commands/skills-install";

export class SkillsCommands {
	Bind(command: Command): void {
		const skills = command
			.command("skills")
			.description(
				"Agent Skills bundled with this CLI, for AI coding agents such as Claude Code",
			);
		new SkillsInstallCommand().Bind(skills);
	}
}
