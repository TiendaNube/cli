import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliLogger } from "../../../../cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
} from "../theme-api-cli-options";
import { ThemeApiClient } from "../theme-api-client";
import { resolveThemeApiBaseUrl } from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	extractInstallationsArray,
	formatInstallationsAsTextTable,
	stringifyListInstallationsResponse,
} from "../theme-api-response-parsers";

type ListOptions = {
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	v: boolean;
};

export class ThemeApiInstallationListCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: ListOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;
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

		const body: unknown = await client.listInstallations();

		if (options.json) {
			process.stdout.write(stringifyListInstallationsResponse(body));
			return;
		}

		const rows = extractInstallationsArray(body);
		if (rows.length === 0) {
			this.logger.Log("No themes returned (empty list).");
			return;
		}

		this.logger.Log(formatInstallationsAsTextTable(rows).trimEnd());
	}

	Bind(command: Command): void {
		const listCmd = command
			.command("list")
			.description("List the themes available for the current store");
		addThemeApiTokenOption(listCmd);
		addHiddenThemeApiUrlOption(listCmd);
		addHiddenThemeApiHeaderOption(listCmd);
		listCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(runAction((opts: ListOptions) => this.Execute(opts)));
	}
}
