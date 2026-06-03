import type { Command } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { addThemeApiTokenOption } from "../theme-api-cli-options";
import { resolveApiCredentials } from "../theme-api-credentials";

type CurrentOptions = {
	token?: string;
};

export class ThemeApiInstallationCurrentCommand {
	private logger = new NubeCliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: CurrentOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
		}
		const { config } = loaded;
		const themeId = config.themeId;

		if (!themeId) {
			this.logger.Error(
				`No theme id saved for the current folder. Run ${getCliExecutableName()} theme pull --theme-id <id>`,
			);
		} else {
			this.logger.Log(`Current theme id is ${themeId}.`);
		}
	}

	Bind(command: Command): void {
		const currentCommand = command
			.command("current")
			.description("Show the theme linked to the current folder");
		addThemeApiTokenOption(currentCommand);
		currentCommand.action(async (opts: CurrentOptions) => {
			await this.Execute(opts);
		});
	}
}
