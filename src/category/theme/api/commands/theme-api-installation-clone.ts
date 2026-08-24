import type { Command } from "commander";
import { Option } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { assertConfirmable, confirmOrAbort } from "../../../../interactivity";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
import {
	formatThemeLabel,
	resolveDerivedTitle,
	resolveThemeLabel,
} from "../../theme-title-resolver";
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
	title?: string;
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

		// Reject an unconfirmable run (non-interactive without --yes) before any
		// network call; the labeled prompt still runs below for interactive runs.
		assertConfirmable(command);

		// Fetch first: a 404 here fails the command before we create anything, and
		// the body feeds both the source label and the derived-title default.
		const installation = await client.getInstallation(themeId);
		const label = formatThemeLabel(installation, themeId);

		const title = await resolveDerivedTitle({
			installation,
			provided: options.title,
			command,
			interaction: this.interaction,
			suffix: "(copy)",
			fallback: "Cloned draft",
		});

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			`Cloning theme ${label} will create a new identical theme in the store. Do you want to continue?`,
		);
		if (!confirmed) {
			return;
		}

		const result = await client.cloneInstallation(themeId, title);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result ?? {}, null, 2)}\n`);
			return;
		}
		const newId = extractThemeIdFromResponse(result);
		const newLabel = newId ? await resolveThemeLabel(client, newId) : null;
		this.logger.Log(
			newLabel
				? `Theme ${label} cloned successfully; new theme ${newLabel} was created.`
				: `Theme ${label} cloned successfully; a new theme was created.`,
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
			.option(
				"--title <title>",
				"Title for the new theme (defaults to '<source> (copy)')",
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
