import type { Command } from "commander";
import { Option } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { resolveThemeIdWithProductive } from "../../theme-workspace-types";
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
	private logger = new NubeCliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: PreviewUrlOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
		}
		const { config } = loaded;
		if (options.installationId !== undefined && options.themeId === undefined) {
			warnDeprecatedOption("--installation-id", "--theme-id");
		}
		const themeId = await resolveThemeIdWithProductive({
			options: {
				themeId: options.themeId ?? options.installationId,
				published: options.published,
			},
			config,
			getClient: () => {
				const baseUrl = resolveThemeApiBaseUrl({
					configUrl: config.apiBaseUrl,
					cliUrl: options.apiUrl,
				});
				const extraHeaders =
					resolveExtraHeadersFromCli(options.header, this.logger) ?? {};
				return new ThemeApiClient({
					apiBaseUrl: baseUrl,
					publicApiToken: config.publicApiToken,
					storeId: config.storeId,
					verbose: false,
					extraHeaders,
				});
			},
			logger: this.logger,
		});
		if (!themeId) {
			if (!options.published) {
				const cli = getCliExecutableName();
				this.logger.Error(
					`No theme id: pass --theme-id, use --published, or run ${cli} theme pull --theme-id <id> (saves to .nuvem).`,
				);
			}
			return;
		}
		const storeUrl = config.storeUrl?.trim();
		if (!storeUrl) {
			const cli = getCliExecutableName();
			this.logger.Error(
				`No store_url in .nuvem: re-run ${cli} theme authorize to save your storefront URL (e.g. https://your-store.nuvemshop.com.br).`,
			);
			return;
		}

		try {
			const url = buildThemeInstallationPreviewUrl(storeUrl, themeId);
			this.logger.Log(url);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(msg);
		}
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
		previewCmd.action(async (opts: PreviewUrlOptions) => {
			await this.Execute(opts);
		});
	}
}
