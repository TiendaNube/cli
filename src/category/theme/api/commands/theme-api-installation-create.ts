import type { Command } from "commander";
import { Option } from "commander";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
} from "../theme-api-cli-options";
import { ThemeApiClient } from "../theme-api-client";
import { resolveThemeApiBaseUrl } from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { warnDeprecatedOption } from "../theme-api-deprecated-options";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import { extractThemeIdFromResponse } from "../theme-api-response-parsers";

type CreateOptions = {
	baseTheme?: string;
	themeCode?: string;
	title: string;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	v: boolean;
};

export class ThemeApiInstallationCreateCommand {
	private logger = new NubeCliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: CreateOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
		}
		const { config } = loaded;

		const baseTheme = (options.baseTheme ?? options.themeCode ?? "").trim();
		if (options.themeCode !== undefined && options.baseTheme === undefined) {
			warnDeprecatedOption("--theme-code", "--base-theme");
		}
		const title = options.title.trim();
		if (!baseTheme || !title) {
			this.logger.Error("--base-theme and --title must be non-empty.");
			return;
		}

		const baseUrl = resolveThemeApiBaseUrl({
			configUrl: config.apiBaseUrl,
			cliUrl: options.apiUrl,
		});
		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);
		if (extraHeaders === null) {
			return;
		}
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: config.publicApiToken,
			storeId: config.storeId,
			verbose: options.v,
			extraHeaders,
		});

		try {
			const result = await client.createInstallation({
				theme_code: baseTheme,
				title,
			});
			if (options.json) {
				process.stdout.write(`${JSON.stringify(result ?? {}, null, 2)}\n`);
				return;
			}
			const newId = extractThemeIdFromResponse(result);
			this.logger.Log(
				newId
					? `Theme ${newId} created successfully.`
					: "Theme created successfully.",
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(msg);
		}
	}

	Bind(command: Command): void {
		const createCmd = command
			.command("create")
			.description("Create a new theme")
			.option(
				"--base-theme <base_theme>",
				"Base catalog theme code (e.g. ipanema)",
			)
			.addOption(
				new Option(
					"--theme-code <theme_code>",
					"Deprecated: use --base-theme",
				).hideHelp(),
			)
			.requiredOption("--title <title>", "Theme title");
		addThemeApiTokenOption(createCmd);
		addHiddenThemeApiUrlOption(createCmd);
		addHiddenThemeApiHeaderOption(createCmd);
		createCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(async (opts: CreateOptions) => {
				await this.Execute(opts);
			});
	}
}
