import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort } from "../../../../interactivity";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";

type PushOptions = {
	v: boolean;
	force: boolean;
};

export class ThemeFtpPushCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PushOptions, command: Command): Promise<void> {
		if (!this.config.IsSet()) {
			throw new CliError(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
		}

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			"Local files will be uploaded and files that no longer exist locally will be deleted from the FTP server. Do you want to continue?",
		);
		if (!confirmed) {
			return;
		}

		this.logger.Log(
			options.force
				? "Starting sync with FTP server (--force: uploading all files)"
				: "Starting sync with FTP server",
		);
		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);
		const result = await client.SyncAll(options.force);
		if (!result.success) {
			throw new CliError(`Sync failed: ${result.errorMessage}`);
		}
	}

	Bind(command: Command): void {
		command
			.command("push")
			.description(
				"Upload theme files from the current directory to the FTP server",
			)
			.option("-v", "Enable verbose logging", false)
			.option("--force", "Skip remote comparison and upload all files", false)
			.action(
				runAction((options: PushOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
