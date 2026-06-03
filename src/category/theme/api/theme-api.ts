import type { Command } from "commander";
import { ThemeApiAuthorizeCommand } from "./commands/theme-api-authorize";
import { ThemeApiInstallationCloneCommand } from "./commands/theme-api-installation-clone";
import { ThemeApiInstallationCreateCommand } from "./commands/theme-api-installation-create";
import { ThemeApiInstallationCurrentCommand } from "./commands/theme-api-installation-current";
import { ThemeApiInstallationDeleteCommand } from "./commands/theme-api-installation-delete";
import { ThemeApiInstallationForkCommand } from "./commands/theme-api-installation-fork";
import { ThemeApiInstallationListCommand } from "./commands/theme-api-installation-list";
import { ThemeApiInstallationPreviewCommand } from "./commands/theme-api-installation-preview";
import { ThemeApiInstallationPublishCommand } from "./commands/theme-api-installation-publish";
import { ThemeApiPullCommand } from "./commands/theme-api-pull";
import { ThemeApiPushCommand } from "./commands/theme-api-push";
import { ThemeApiWatchCommand } from "./commands/theme-api-watch";
import { ThemeApiDeprecatedInstallationCommands } from "./theme-api-deprecated-installation";

export class ThemeApiCommands {
	/** Register Public API subcommands on an existing `theme` command. */
	Bind(theme: Command): void {
		new ThemeApiAuthorizeCommand().Bind(theme);
		new ThemeApiInstallationListCommand().Bind(theme);
		new ThemeApiInstallationCreateCommand().Bind(theme);
		new ThemeApiInstallationCloneCommand().Bind(theme);
		new ThemeApiInstallationPublishCommand().Bind(theme);
		new ThemeApiInstallationForkCommand().Bind(theme);
		new ThemeApiInstallationPreviewCommand().Bind(theme);
		new ThemeApiInstallationDeleteCommand().Bind(theme);
		new ThemeApiInstallationCurrentCommand().Bind(theme);
		new ThemeApiPullCommand().Bind(theme);
		new ThemeApiPushCommand().Bind(theme);
		new ThemeApiWatchCommand().Bind(theme);
		new ThemeApiDeprecatedInstallationCommands().Bind(theme);
	}
}
