import type { Command } from "commander";
import { Option } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliLogger } from "../../../../cli-logger";
import { addRequiredOption } from "../../../../cli-required-option";
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
import {
	validateBaseThemeCode,
	validateBaseThemeVariant,
} from "../theme-api-prompt-validators";
import { extractThemeIdFromResponse } from "../theme-api-response-parsers";

type CreateOptions = {
	baseTheme?: string;
	themeCode?: string;
	title: string;
	baseThemeVariant?: string;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	v: boolean;
};

export class ThemeApiInstallationCreateCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: CreateOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;

		const baseTheme = (options.baseTheme ?? "").trim();
		const title = options.title.trim();
		if (!baseTheme || !title) {
			throw new CliError("--base-theme and --title must be non-empty.");
		}

		const baseThemeVariant = options.baseThemeVariant?.trim();
		if (baseThemeVariant !== undefined) {
			const error = validateBaseThemeVariant(baseThemeVariant);
			if (error) throw new CliError(error);
		}

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

		const result = await client.createInstallation({
			theme_code: baseTheme,
			title,
			...(baseThemeVariant ? { theme_variant: baseThemeVariant } : {}),
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
	}

	Bind(command: Command): void {
		const createCmd = command
			.command("create")
			.description("Create a new theme");
		createCmd.hook("preAction", (_thisCmd, actionCmd) => {
			const baseTheme = actionCmd.getOptionValue("baseTheme");
			const themeCode = actionCmd.getOptionValue("themeCode");
			if (baseTheme === undefined && themeCode !== undefined) {
				warnDeprecatedOption("--theme-code", "--base-theme");
				actionCmd.setOptionValue("baseTheme", themeCode);
			}
		});
		addRequiredOption(
			createCmd,
			"--base-theme <base_theme>",
			"Base catalog theme code (e.g. ipanema)",
			{ validate: validateBaseThemeCode },
		);
		createCmd.addOption(
			new Option(
				"--theme-code <theme_code>",
				"Deprecated: use --base-theme",
			).hideHelp(),
		);
		addRequiredOption(createCmd, "--title <title>", "Theme title");
		createCmd.option(
			"--base-theme-variant <base_theme_variant>",
			"Base theme variant; letters only, first letter uppercase (e.g. Clothing)",
		);
		addThemeApiTokenOption(createCmd);
		addHiddenThemeApiUrlOption(createCmd);
		addHiddenThemeApiHeaderOption(createCmd);
		createCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(runAction((opts: CreateOptions) => this.Execute(opts)));
	}
}
