import { Command } from "commander";
import updateNotifier from "update-notifier";
import packageJson from "../package.json" with { type: "json" };
import { NubesdkCommands } from "./category/nubesdk/nubesdk";
import { SkillsCommands } from "./category/skills/skills";
import { skillsHelpFooter } from "./category/skills/skills-help";
import { ThemeCommands } from "./category/theme/theme-commands";
import { getCliExecutableName } from "./cli-executable-name";
import { CliLogger } from "./cli-logger";
import { TelemetryCommands } from "./telemetry/commands/telemetry-command";

const program = new Command();

program
	.name(getCliExecutableName())
	.description(packageJson.description)
	.version(packageJson.version)
	.option(
		"-y, --yes",
		"Non-interactive: never prompt; assume confirmations",
		false,
	);

// Printed only when someone asks for help, and only when the machine has an agent
// the skills could serve.
program.addHelpText("after", () => skillsHelpFooter());

// NubeSDK commands are hidden until NubeSDK support on Core Storefronts is publicly announced
// new NubesdkCommands().Bind(program);
new ThemeCommands().Bind(program);
new SkillsCommands().Bind(program);
new TelemetryCommands().Bind(program);

updateNotifier({
	pkg: { name: packageJson.name, version: packageJson.version },
}).notify();

program.parseAsync(process.argv).catch((err) => {
	new CliLogger().Error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
