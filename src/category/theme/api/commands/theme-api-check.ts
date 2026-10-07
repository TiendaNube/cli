import path from "node:path";
import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliLogger } from "../../../../cli-logger";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
	addThemePublishedOption,
} from "../theme-api-cli-options";
import { ThemeApiClient } from "../theme-api-client";
import { resolveThemeApiBaseUrl } from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { buildThemeDiffPlan } from "../theme-api-diff-plan";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import { validateThemeFiles } from "../theme-api-file-validation";

type CheckOptions = {
	themeId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	v: boolean;
};

export class ThemeApiCheckCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: CheckOptions,
		command: Command,
	): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;
		const baseUrl = resolveThemeApiBaseUrl({
			configUrl: config.apiBaseUrl,
			cliUrl: options.apiUrl,
		});
		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: config.publicApiToken,
			storeId: config.storeId,
			verbose: options.v,
			extraHeaders,
		});

		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => client,
		});

		// Same diff as `theme push`, so a check covers exactly what a push would send.
		this.logger.Log("Fetching remote files…");
		const { diff, readFailCount } = await buildThemeDiffPlan({
			client,
			themeId,
			cwd: path.resolve("./"),
			onNotice: (message) => this.logger.Log(message),
			onFileError: (message) => this.logger.Error(message),
		});
		const files = [...diff.toCreate, ...diff.toUpdate];

		this.logger.Log(`Checking ${files.length} file(s)…`);
		const result = await validateThemeFiles({
			client,
			themeId,
			files,
			onInvalid: (line) => this.logger.Error(line),
		});
		if (result.unsupported) {
			throw new CliError(
				"This store's API does not support file validation yet.",
			);
		}

		if (result.invalidCount > 0 || readFailCount > 0) {
			const reasons: string[] = [];
			if (result.invalidCount > 0)
				reasons.push(`${result.invalidCount} file(s) failed validation`);
			if (readFailCount > 0)
				reasons.push(`${readFailCount} file(s) could not be read`);
			throw new CliError(`Check failed: ${reasons.join(", ")}.`);
		}
		this.logger.Log(
			files.length === 0
				? "No changed files to check."
				: `All ${files.length} file(s) are valid.`,
		);
	}

	Bind(command: Command): void {
		const checkCmd = command
			.command("check")
			.description(
				"Validate the local theme files a push would send, the way Nuvemshop/Tiendanube checks them on save, without uploading",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			);
		addThemePublishedOption(checkCmd);
		addThemeApiTokenOption(checkCmd);
		addHiddenThemeApiUrlOption(checkCmd);
		addHiddenThemeApiHeaderOption(checkCmd);
		checkCmd
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: CheckOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
