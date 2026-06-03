import type { Command } from "commander";
import { Option } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { resolveThemeId } from "../../theme-workspace-types";
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

type DeleteOptions = {
	themeId?: string;
	installationId?: string;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	y: boolean;
	v: boolean;
};

export class ThemeApiInstallationDeleteCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: DeleteOptions): Promise<void> {
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
		const themeId = resolveThemeId(
			options.themeId ?? options.installationId,
			config,
		);
		if (!themeId) {
			const cli = getCliExecutableName();
			this.logger.Error(
				`No theme id: pass --theme-id or run ${cli} theme pull --theme-id <id> (saves to .nuvem).`,
			);
			return;
		}

		if (!options.y) {
			const confirm = await this.interaction.Confirm(
				`This will permanently delete theme ${themeId} from the store. This cannot be undone. Do you want to continue?`,
			);
			if (!confirm) {
				return;
			}
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
			const result = await client.deleteInstallation(themeId);
			if (options.json) {
				const payload =
					result !== null && result !== undefined && result !== ""
						? result
						: { message: `Theme ${themeId} deleted successfully.` };
				process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
				return;
			}
			this.logger.Log(`Theme ${themeId} deleted successfully.`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(msg);
		}
	}

	Bind(command: Command): void {
		const deleteCmd = command
			.command("delete")
			.description("Delete a theme")
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
		addThemeApiTokenOption(deleteCmd);
		addHiddenThemeApiUrlOption(deleteCmd);
		addHiddenThemeApiHeaderOption(deleteCmd);
		deleteCmd
			.option("-y", "Skip confirmation prompt", false)
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(async (opts: DeleteOptions) => {
				await this.Execute(opts);
			});
	}
}
