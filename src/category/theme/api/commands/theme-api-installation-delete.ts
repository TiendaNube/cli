import type { Command } from "commander";
import { Option } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort } from "../../../../interactivity";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
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

type DeleteOptions = {
	themeId?: string;
	installationId?: string;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	v: boolean;
};

export class ThemeApiInstallationDeleteCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: DeleteOptions,
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
			supportsPublished: false,
		});

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			`This will permanently delete theme ${themeId} from the store. This cannot be undone. Do you want to continue?`,
		);
		if (!confirmed) {
			return;
		}

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
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: DeleteOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
