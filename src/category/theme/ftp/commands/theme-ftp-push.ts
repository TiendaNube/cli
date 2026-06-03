import type { Command } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";

type PushOptions = {
	y: boolean;
	v: boolean;
	force: boolean;
};

export class ThemeFtpPushCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PushOptions): Promise<void> {
		if (!this.config.IsSet()) {
			this.logger.Error(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
			return;
		}

		if (!options.y) {
			const confirm = await this.interaction.Confirm(
				"Local files will be uploaded and files that no longer exist locally will be deleted from the FTP server. Do you want to continue?",
			);
			if (!confirm) {
				return;
			}
		}

		this.logger.Log(
			options.force
				? "Starting sync with FTP server (--force: uploading all files)"
				: "Starting sync with FTP server",
		);
		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);
		const result = await client.SyncAll(options.force);
		if (!result.success) {
			this.logger.Error(`Sync failed: ${result.errorMessage}`);
		}
	}

	Bind(command: Command): void {
		command
			.command("push")
			.description(
				"Upload theme files from the current directory to the FTP server",
			)
			.option("-y", "Skip confirmation prompt", false)
			.option("-v", "Enable verbose logging", false)
			.option("--force", "Skip remote comparison and upload all files", false)
			.action(async (options) => {
				await this.Execute(options);
			});
	}
}
