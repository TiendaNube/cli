import fs from "node:fs";
import path from "node:path";
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
import {
	decodeRemoteFileContent,
	isPathInsideThemeRoot,
} from "../theme-api-file-format";
import { fetchAllRemoteFiles } from "../theme-api-remote-content";
import {
	listThemeEntries,
	removeThemeEntries,
	shouldSync,
} from "../theme-api-workspace-files";

type PullOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	v: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ThemeApiPullCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: PullOptions, command: Command): Promise<void> {
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

		const themeEntries = listThemeEntries(".");
		if (themeEntries.length > 0) {
			const confirmed = await confirmOrAbort(
				command,
				this.interaction,
				`Current directory has ${themeEntries.length} synced file(s)/folder(s) that will be deleted before pulling (files outside sync scope are preserved). Do you want to continue?`,
			);
			if (!confirmed) {
				return;
			}
			removeThemeEntries(".", themeEntries);
		}

		this.logger.Log("Downloading theme files from API…");
		const { installation, files: allFiles } = await fetchAllRemoteFiles(
			client,
			themeId,
		);

		const cwd = path.resolve(".");
		for (const file of allFiles) {
			const rel = file.path.replace(/\\/g, "/");
			if (!shouldSync(rel)) {
				continue;
			}
			if (!isPathInsideThemeRoot(cwd, rel)) {
				throw new CliError(`Refusing to write unsafe path: ${rel}`);
			}
			const dest = path.join(cwd, rel);
			const dir = path.dirname(dest);
			fs.mkdirSync(dir, { recursive: true });
			const payload = decodeRemoteFileContent(file.content, file.format);
			if (Buffer.isBuffer(payload)) {
				fs.writeFileSync(dest, payload);
			} else {
				fs.writeFileSync(dest, payload, "utf8");
			}
			this.logger.Log(`  ${rel}`);
		}

		const inst = installation;
		let manifest: Record<string, unknown> = {
			theme_id: themeId,
		};
		if (isRecord(inst)) {
			manifest = {
				theme: inst.theme ?? null,
				theme_version: inst.theme_version ?? null,
				forked: inst.forked ?? false,
				revision_token: inst.revision_token ?? null,
				theme_id: inst.id ?? themeId,
			};
		}
		const persistedThemeId =
			typeof manifest.theme_id === "string" && manifest.theme_id.trim() !== ""
				? manifest.theme_id.trim()
				: themeId;
		if (!loaded.ephemeral) {
			this.workspace.mergeWorkspace({
				"theme-api": {
					...config,
					themeId: persistedThemeId,
				},
			});
		}
		const manifestPath = path.join(cwd, "manifest.json");
		fs.writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		this.logger.Log("  manifest.json");
		this.logger.Log("Download completed.");
	}

	Bind(command: Command): void {
		const pullCmd = command
			.command("pull")
			.description(
				"Download theme files from Nuvemshop/Tiendanube to the current directory",
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
		addThemePublishedOption(pullCmd);
		addThemeApiTokenOption(pullCmd);
		addHiddenThemeApiUrlOption(pullCmd);
		addHiddenThemeApiHeaderOption(pullCmd);
		pullCmd
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: PullOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
