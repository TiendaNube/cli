import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { addThemeApiTokenOption } from "../theme-api-cli-options";
import { resolveApiCredentials } from "../theme-api-credentials";

type CurrentOptions = {
	token?: string;
};

export class ThemeApiInstallationCurrentCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: CurrentOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;
		const themeId = config.themeId;

		if (!themeId) {
			throw new CliError(
				`No theme id saved for the current folder. Run ${getCliExecutableName()} theme pull --theme-id <id>`,
			);
		}
		this.logger.Log(`Current theme id is ${themeId}.`);
	}

	Bind(command: Command): void {
		const currentCommand = command
			.command("current")
			.description("Show the theme linked to the current folder");
		addThemeApiTokenOption(currentCommand);
		currentCommand.action(
			runAction((opts: CurrentOptions) => this.Execute(opts)),
		);
	}
}
