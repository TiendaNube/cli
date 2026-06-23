import type { Command } from "commander";
import { Option } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
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
import { warnDeprecatedOption } from "../theme-api-deprecated-options";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import { buildThemeInstallationPreviewUrl } from "../theme-api-preview-url";

type PreviewUrlOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
};

export class ThemeApiInstallationPreviewCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: PreviewUrlOptions,
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
		if (options.installationId !== undefined && options.themeId === undefined) {
			warnDeprecatedOption("--installation-id", "--theme-id");
		}
		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => {
				const baseUrl = resolveThemeApiBaseUrl({
					configUrl: config.apiBaseUrl,
					cliUrl: options.apiUrl,
				});
				const extraHeaders = resolveExtraHeadersFromCli(
					options.header,
					this.logger,
				);
				return new ThemeApiClient({
					apiBaseUrl: baseUrl,
					publicApiToken: config.publicApiToken,
					storeId: config.storeId,
					verbose: false,
					extraHeaders,
				});
			},
		});
		const storeUrl = config.storeUrl?.trim();
		if (!storeUrl) {
			const cli = getCliExecutableName();
			throw new CliError(
				`No store_url in .nuvem: re-run ${cli} theme authorize to save your storefront URL (e.g. https://your-store.nuvemshop.com.br).`,
			);
		}

		const url = buildThemeInstallationPreviewUrl(storeUrl, themeId);
		this.logger.Log(url);
	}

	Bind(command: Command): void {
		const previewCmd = command
			.command("preview")
			.description(
				"Print a shareable preview URL for the theme (use before publishing)",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			)
			.addOption(
				new Option(
					"--installation-id <installation_id>",
					"Deprecated: use --theme-id",
				).hideHelp(),
			);
		addThemePublishedOption(previewCmd);
		addThemeApiTokenOption(previewCmd);
		addHiddenThemeApiUrlOption(previewCmd);
		addHiddenThemeApiHeaderOption(previewCmd);
		previewCmd.action(
			runAction((opts: PreviewUrlOptions, command: Command) =>
				this.Execute(opts, command),
			),
		);
	}
}
