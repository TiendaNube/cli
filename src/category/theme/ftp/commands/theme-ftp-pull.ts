import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort } from "../../../../interactivity";
import { authAliasOption } from "../../../auth/cli/auth-cli-options";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import { ThemeFtpTools } from "../theme-ftp-tools";

type PullOptions = {
	alias?: string;
	v: boolean;
};

export class ThemeFtpPullCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PullOptions, command: Command): Promise<void> {
		const loaded = this.config.TryLoad({ alias: options.alias });
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}

		const themeEntries = ThemeFtpTools.listThemeEntries(".");
		if (themeEntries.length > 0) {
			const confirmed = await confirmOrAbort(
				command,
				this.interaction,
				`Current directory has ${themeEntries.length} non-hidden file(s)/folder(s) that will be deleted before pulling (hidden entries like .nuvem and .git are preserved). Do you want to continue?`,
			);
			if (!confirmed) {
				return;
			}
			ThemeFtpTools.cleanThemeWorkspace(".", themeEntries);
		}

		this.logger.Log("Starting file download from FTP server");
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig, loaded);
		const result = await client.DownloadAll();
		if (result.success) {
			// Records the origin so an API push refuses to upload these files to a
			// sections-based theme.
			this.config.MarkPulled();
			this.logger.Log("Download completed");
		} else {
			throw new CliError(`Download failed: ${result.errorMessage}`);
		}
	}

	Bind(command: Command): void {
		command
			.command("pull")
			.description(
				"Download theme files from the FTP server to the current directory",
			)
			.addOption(authAliasOption())
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((options: PullOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
