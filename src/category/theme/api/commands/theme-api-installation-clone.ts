import type { Command } from "commander";
import { Option } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
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
import { extractThemeIdFromResponse } from "../theme-api-response-parsers";

type CloneOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	y: boolean;
	v: boolean;
};

export class ThemeApiInstallationCloneCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: CloneOptions): Promise<void> {
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

		const themeId = await resolveThemeIdWithProductive({
			options: {
				themeId: options.themeId ?? options.installationId,
				published: options.published,
			},
			config,
			getClient: () => client,
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

		if (!options.y) {
			const confirm = await this.interaction.Confirm(
				`Cloning theme ${themeId} will create a new identical theme in the store. Do you want to continue?`,
			);
			if (!confirm) {
				return;
			}
		}

		try {
			const result = await client.cloneInstallation(themeId);
			if (options.json) {
				process.stdout.write(`${JSON.stringify(result ?? {}, null, 2)}\n`);
				return;
			}
			const newId = extractThemeIdFromResponse(result);
			this.logger.Log(
				newId
					? `Theme ${themeId} cloned successfully; new theme ${newId} was created.`
					: `Theme ${themeId} cloned successfully; a new theme was created.`,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(msg);
		}
	}

	Bind(command: Command): void {
		const cloneCmd = command
			.command("clone")
			.description("Clone a theme")
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
		addThemePublishedOption(cloneCmd);
		addThemeApiTokenOption(cloneCmd);
		addHiddenThemeApiUrlOption(cloneCmd);
		addHiddenThemeApiHeaderOption(cloneCmd);
		cloneCmd
			.option("-y", "Skip confirmation prompt", false)
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(async (opts: CloneOptions) => {
				await this.Execute(opts);
			});
	}
}
