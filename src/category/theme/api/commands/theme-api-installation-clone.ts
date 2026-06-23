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
	v: boolean;
};

export class ThemeApiInstallationCloneCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: CloneOptions,
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
		});

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			`Cloning theme ${themeId} will create a new identical theme in the store. Do you want to continue?`,
		);
		if (!confirmed) {
			return;
		}

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
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: CloneOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
