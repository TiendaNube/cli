import type { Command } from "commander";
import { CliError, runAction } from "../../../cli-action";
import { CliInteraction } from "../../../cli-interaction";
import { CliLogger } from "../../../cli-logger";
import { confirmOrAbort } from "../../../interactivity";
import {
	SKILLS_AGENTS,
	type SkillsAgent,
	type SkillsDestination,
	type SkillsScope,
	agentNames,
	detectInstalledAgents,
	findAgent,
	resolveDestinations,
} from "../skills-agents";
import {
	type SkillsLinkAction,
	type SkillsLinkMode,
	type SkillsLinkResult,
	applySkillLink,
	planSkillLink,
} from "../skills-link";
import {
	listPackagedSkills,
	resolvePackagedSkillsDir,
} from "../skills-packaged";

type InstallOptions = {
	project: boolean;
	agent?: string[];
	all: boolean;
	copy: boolean;
	dryRun: boolean;
	json: boolean;
};

type DestinationPlan = SkillsDestination & {
	skills: SkillsLinkResult[];
};

const ACTIONS: SkillsLinkAction[] = [
	"created",
	"updated",
	"unchanged",
	"conflict",
];

function summarize(
	skills: SkillsLinkResult[],
): Record<SkillsLinkAction, number> {
	const summary: Record<SkillsLinkAction, number> = {
		created: 0,
		updated: 0,
		unchanged: 0,
		conflict: 0,
	};
	for (const skill of skills) {
		summary[skill.action] += 1;
	}
	return summary;
}

function describeSummary(skills: SkillsLinkResult[]): string {
	const summary = summarize(skills);
	return ACTIONS.filter((action) => summary[action] > 0)
		.map((action) => `${summary[action]} ${action}`)
		.join(", ");
}

export class SkillsInstallCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();

	private async Execute(
		options: InstallOptions,
		command: Command,
	): Promise<void> {
		const sourceDir = resolvePackagedSkillsDir();
		if (sourceDir === "") {
			throw new CliError(
				"No bundled skills found next to this CLI. Reinstall the package (npm i -g @tiendanube/cli) and try again.",
			);
		}
		const names = listPackagedSkills(sourceDir);
		if (names.length === 0) {
			throw new CliError(`No skills found in ${sourceDir}.`);
		}

		const scope: SkillsScope = options.project ? "project" : "global";
		const mode: SkillsLinkMode = options.copy ? "copy" : "symlink";
		const destinations = resolveDestinations({
			agents: this.resolveAgents(options),
			scope,
			cwd: process.cwd(),
		});

		const plans: DestinationPlan[] = destinations.map((destination) => ({
			...destination,
			skills: names.map((name) =>
				planSkillLink({
					sourceDir,
					destinationDir: destination.path,
					name,
					mode,
				}),
			),
		}));

		if (options.dryRun) {
			this.Report({ plans, sourceDir, names, scope, mode, options });
			return;
		}

		const conflicts = plans.flatMap((plan) =>
			plan.skills
				.filter((skill) => skill.action === "conflict")
				.map((skill) => `${plan.path}/${skill.name}`),
		);
		if (conflicts.length > 0) {
			const confirmed = await confirmOrAbort(
				command,
				this.interaction,
				`These paths already exist and are not links this command created, so installing would replace them: ${conflicts.join(", ")}. Do you want to continue?`,
			);
			if (!confirmed) {
				return;
			}
		}

		const applied: DestinationPlan[] = plans.map((plan) => ({
			...plan,
			skills: names.map((name) =>
				applySkillLink({
					sourceDir,
					destinationDir: plan.path,
					name,
					mode,
					force: true,
				}),
			),
		}));

		this.Report({ plans: applied, sourceDir, names, scope, mode, options });
	}

	/** Explicit `--agent` wins, then `--all`, then what the machine has. */
	private resolveAgents(options: InstallOptions): SkillsAgent[] {
		if (options.agent !== undefined && options.agent.length > 0) {
			return options.agent.map((name) => {
				const agent = findAgent(name);
				if (agent === undefined) {
					throw new CliError(
						`Unknown agent "${name}". Available: ${agentNames().join(", ")}.`,
					);
				}
				return agent;
			});
		}
		if (options.all) {
			return SKILLS_AGENTS;
		}
		const detected = detectInstalledAgents();
		if (detected.length === 0) {
			throw new CliError(
				`No supported agent found on this machine. Pass --agent <name> to pick one (${agentNames().join(", ")}), or --all for every supported agent.`,
			);
		}
		return detected;
	}

	private Report(context: {
		plans: DestinationPlan[];
		sourceDir: string;
		names: string[];
		scope: SkillsScope;
		mode: SkillsLinkMode;
		options: InstallOptions;
	}): void {
		if (context.options.json) {
			process.stdout.write(
				`${JSON.stringify(
					{
						scope: context.scope,
						mode: context.mode,
						dryRun: context.options.dryRun,
						source: context.sourceDir,
						skills: context.names,
						destinations: context.plans.map((plan) => ({
							agents: plan.agents,
							path: plan.path,
							summary: summarize(plan.skills),
							skills: plan.skills,
						})),
					},
					null,
					2,
				)}\n`,
			);
			return;
		}

		this.logger.Log(
			`${context.names.length} skill(s) from ${context.sourceDir} (${context.mode}, ${context.scope} scope)`,
		);
		for (const plan of context.plans) {
			this.logger.Log(
				`  ${plan.path} [${plan.agents.join(", ")}]: ${describeSummary(plan.skills)}`,
			);
		}
		if (context.options.dryRun) {
			this.logger.Log("Dry run: nothing was changed.");
			return;
		}
		this.logger.Log(
			"Start a new agent session to pick up the skills — most agents read them at startup.",
		);
	}

	Bind(command: Command): void {
		command
			.command("install")
			.description(
				"Install the skills bundled with this CLI into the coding agents on this machine",
			)
			.option(
				"--project",
				"Install into the current directory instead of the user's home",
				false,
			)
			.option(
				"--agent <name...>",
				`Install for these agents instead of the detected ones: ${agentNames().join(", ")}`,
			)
			.option("--all", "Install for every supported agent", false)
			.option("--copy", "Copy the skills instead of creating symlinks", false)
			.option("--dry-run", "Report what would be installed, then stop", false)
			.option("--json", "Use machine-readable JSON output", false)
			.action(
				runAction((options: InstallOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
