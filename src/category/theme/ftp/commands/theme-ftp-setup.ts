import fs from "node:fs";
import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { addRequiredOption } from "../../../../cli-required-option";
import { confirmOrAbort } from "../../../../interactivity";
import { ThemeFtpClient } from "../theme-ftp-client";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import {
	normalizeFtpServer,
	normalizeStoreUrl,
	validateStoreUrl,
} from "../theme-ftp-prompt-validators";

type SetupOptions = {
	ftpServer: string;
	ftpUsername: string;
	ftpPassword: string;
	storeUrl: string;
	v: boolean;
};

export class ThemeFtpSetupCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private configurationManager = new ThemeFtpConfigManager();

	private async Execute(
		options: SetupOptions,
		command: Command,
	): Promise<void> {
		const files = fs.readdirSync(".");
		if (files.length > 0) {
			const confirmed = await confirmOrAbort(
				command,
				this.interaction,
				"We recommend running setup in an empty directory so the theme workspace remains isolated from unrelated files. This directory is not empty; you may still proceed if that is intentional. Do you want to continue with setup?",
			);
			if (!confirmed) {
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
			throw new CliError(
				`FTP connection failed: ${ftpTestResult.errorMessage}`,
			);
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
		const setupCmd = command
			.command("setup")
			.description(
				"Configure credentials and store for theme development using legacy FTP mode",
			);
		addRequiredOption(setupCmd, "--ftp-server <ftp_server>", "FTP server URL", {
			normalize: normalizeFtpServer,
		});
		addRequiredOption(
			setupCmd,
			"--ftp-username <ftp_username>",
			"FTP username",
		);
		addRequiredOption(
			setupCmd,
			"--ftp-password <ftp_password>",
			"FTP password",
			{ mask: true },
		);
		addRequiredOption(
			setupCmd,
			"--store-url <store_url>",
			"Nuvemshop/Tiendanube store URL (e.g. https://your-store.lojavirtualnuvem.com.br)",
			{ validate: validateStoreUrl, normalize: normalizeStoreUrl },
		);
		setupCmd
			.option("-v", "Enable verbose logging", false)
			.allowExcessArguments(true)
			.action(
				runAction((options: SetupOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
