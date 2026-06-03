import type { Command } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import { ThemeFtpTools } from "../theme-ftp-tools";

type PullOptions = {
	y: boolean;
	v: boolean;
};

export class ThemeFtpPullCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PullOptions): Promise<void> {
		if (!this.config.IsSet()) {
			this.logger.Error(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
			return;
		}

		const themeEntries = ThemeFtpTools.listThemeEntries(".");
		if (themeEntries.length > 0) {
			if (!options.y) {
				const confirm = await this.interaction.Confirm(
					`Current directory has ${themeEntries.length} non-hidden file(s)/folder(s) that will be deleted before pulling (hidden entries like .nuvem and .git are preserved). Do you want to continue?`,
				);
				if (!confirm) {
					return;
				}
			}
			ThemeFtpTools.cleanThemeWorkspace(".", themeEntries);
		}

		this.logger.Log("Starting file download from FTP server");
		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);
		const result = await client.DownloadAll();
		if (result.success) {
			this.logger.Log("Download completed");
		} else {
			this.logger.Error(`Download failed: ${result.errorMessage}`);
		}
	}

	Bind(command: Command): void {
		command
			.command("pull")
			.description(
				"Download theme files from the FTP server to the current directory",
			)
			.option("-y", "Skip confirmation prompt", false)
			.option("-v", "Enable verbose logging", false)
			.action(async (options) => {
				await this.Execute(options);
			});
	}
}
