import fs from "node:fs";
import type { Command } from "commander";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeFtpClient } from "../theme-ftp-client";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";

type SetupOptions = {
	ftpServer: string;
	ftpUsername: string;
	ftpPassword: string;
	storeUrl: string;
	y: boolean;
	v: boolean;
};

export class ThemeFtpSetupCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private configurationManager = new ThemeFtpConfigManager();

	private async Execute(options: SetupOptions): Promise<void> {
		const files = fs.readdirSync(".");
		if (files.length > 0 && !options.y) {
			const confirm = await this.interaction.Confirm(
				"We recommend running setup in an empty directory so the theme workspace remains isolated from unrelated files. This directory is not empty; you may still proceed if that is intentional. Do you want to continue with setup?",
			);
			if (!confirm) {
				this.logger.Error("Setup aborted.");
				return;
			}
		}

		this.logger.Log("Testing FTP connection to Nuvemshop/Tiendanube");

		const ftpTestResult = await new ThemeFtpClient({
			ftpServer: options.ftpServer,
			ftpUsername: options.ftpUsername,
			ftpPassword: options.ftpPassword,
			verbose: options.v,
		}).Test();

		if (ftpTestResult.success) {
			this.logger.Log("FTP connection successful");
		} else {
			this.logger.Error(`FTP connection failed: ${ftpTestResult.errorMessage}`);
			return;
		}

		this.configurationManager.Save({
			ftp: {
				ftpServer: options.ftpServer,
				ftpUsername: options.ftpUsername,
				ftpPassword: options.ftpPassword,
				verbose: false,
			},
			storeUrl: options.storeUrl,
		});
		this.logger.Log(
			"Store configuration file saved. You can now use theme ftp pull, theme ftp push, and theme ftp watch.",
		);
	}

	Bind(command: Command): void {
		command
			.command("setup")
			.description(
				"Configure credentials and store for theme development using legacy FTP mode",
			)
			.requiredOption("--ftp-server <ftp_server>", "FTP server URL")
			.requiredOption("--ftp-username <ftp_username>", "FTP username")
			.requiredOption("--ftp-password <ftp_password>", "FTP password")
			.requiredOption(
				"--store-url <store_url>",
				"Nuvemshop/Tiendanube store URL (e.g. https://your-store.lojavirtualnuvem.com.br)",
			)
			.option("-y", "Skip confirmation prompt", false)
			.option("-v", "Enable verbose logging", false)
			.allowExcessArguments(true)
			.action(async (options) => {
				await this.Execute(options);
			});
	}
}
