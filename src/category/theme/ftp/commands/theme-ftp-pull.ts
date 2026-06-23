import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort } from "../../../../interactivity";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import { ThemeFtpTools } from "../theme-ftp-tools";

type PullOptions = {
	v: boolean;
};

export class ThemeFtpPullCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PullOptions, command: Command): Promise<void> {
		if (!this.config.IsSet()) {
			throw new CliError(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
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
		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);
		const result = await client.DownloadAll();
		if (result.success) {
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
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((options: PullOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
