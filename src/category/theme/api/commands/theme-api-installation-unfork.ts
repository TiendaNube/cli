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

type UnforkOptions = {
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

export class ThemeApiInstallationUnforkCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: UnforkOptions,
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

		// One fetch feeds both the source label and the default title, and proves
		// the source exists before the destructive confirm.
		const installation = await client.getInstallation(themeId);
		const label = formatThemeLabel(installation, themeId);

		const title = await resolveDerivedTitle({
			installation,
			provided: options.title,
			command,
			interaction: this.interaction,
			suffix: "(unforked)",
			fallback: "Unforked draft",
		});

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			`Unforking theme ${label} creates a new draft that keeps your templates and settings but drops the forked theme code, re-enabling automatic Nuvemshop/Tiendanube updates. The source theme is left untouched. Do you want to continue?`,
		);
		if (!confirmed) {
			return;
		}

		const result = await client.unforkInstallation(themeId, title);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result ?? {}, null, 2)}\n`);
			return;
		}
		const newId = extractThemeIdFromResponse(result);
		const newLabel = newId ? await resolveThemeLabel(client, newId) : null;
		this.logger.Log(
			newLabel
				? `Theme ${label} unforked successfully; new theme ${newLabel} was created.`
				: `Theme ${label} unforked successfully; a new theme was created.`,
		);
	}

	Bind(command: Command): void {
		const unforkCmd = command
			.command("unfork")
			.description(
				"Unfork a theme into a new draft, dropping forked code and re-enabling automatic updates",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			)
			.option(
				"--title <title>",
				"Title for the new theme (defaults to '<source> (unforked)')",
			)
			.addOption(
				new Option(
					"--installation-id <installation_id>",
					"Deprecated: use --theme-id",
				).hideHelp(),
			);
		addThemePublishedOption(unforkCmd);
		addThemeApiTokenOption(unforkCmd);
		addHiddenThemeApiUrlOption(unforkCmd);
		addHiddenThemeApiHeaderOption(unforkCmd);
		unforkCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: UnforkOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
