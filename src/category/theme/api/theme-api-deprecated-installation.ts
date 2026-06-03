import type { Command } from "commander";
import { NubeCliLogger } from "../../../nube-cli-logger";
import { ThemeApiInstallationCloneCommand } from "./commands/theme-api-installation-clone";
import { ThemeApiInstallationCreateCommand } from "./commands/theme-api-installation-create";
import { ThemeApiInstallationCurrentCommand } from "./commands/theme-api-installation-current";
import { ThemeApiInstallationDeleteCommand } from "./commands/theme-api-installation-delete";
import { ThemeApiInstallationForkCommand } from "./commands/theme-api-installation-fork";
import { ThemeApiInstallationListCommand } from "./commands/theme-api-installation-list";
import { ThemeApiInstallationPreviewCommand } from "./commands/theme-api-installation-preview";
import { ThemeApiInstallationPublishCommand } from "./commands/theme-api-installation-publish";

export class ThemeApiDeprecatedInstallationCommands {
	private logger = new NubeCliLogger();

	Bind(theme: Command): void {
		const installation = theme
			.command("installation", { hidden: true })
			.description("Deprecated: use 'theme <verb>' directly.");

		installation.hook("preAction", (_thisCommand, actionCommand) => {
			const verb = actionCommand.name();
			this.logger.Warn(
				`Warning: 'theme installation ${verb}' is deprecated. Use 'theme ${verb}' instead.`,
			);
		});

		new ThemeApiInstallationListCommand().Bind(installation);
		new ThemeApiInstallationCreateCommand().Bind(installation);
		new ThemeApiInstallationCloneCommand().Bind(installation);
		new ThemeApiInstallationPublishCommand().Bind(installation);
		new ThemeApiInstallationForkCommand().Bind(installation);
		new ThemeApiInstallationPreviewCommand().Bind(installation);
		new ThemeApiInstallationDeleteCommand().Bind(installation);
		new ThemeApiInstallationCurrentCommand().Bind(installation);
	}
}
