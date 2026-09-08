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
import { buildThemeDiffPlan } from "../theme-api-diff-plan";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";

type PushOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	v: boolean;
	force: boolean;
};

export class ThemeApiPushCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: PushOptions, command: Command): Promise<void> {
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
			"Files on the theme will be overwritten, and files that no longer exist locally will be deleted. Do you want to continue?",
		);
		if (!confirmed) {
			return;
		}

		this.logger.Log(
			options.force
				? "Starting sync (--force: uploading all files)"
				: "Starting sync",
		);

		const cwd = path.resolve("./");

		if (!options.force) this.logger.Log("Fetching remote files…");
		const { diff, skippedNotForked, unchangedNonForkedCount, readFailCount } =
			await buildThemeDiffPlan({
				client,
				themeId,
				cwd,
				force: options.force,
				onNotice: (message) => this.logger.Log(message),
				onFileError: (message) => this.logger.Error(message),
			});

		const toUpsert = [...diff.toCreate, ...diff.toUpdate];
		const totalUnchanged = diff.unchanged + unchangedNonForkedCount;

		this.logger.Log(
			`Syncing: ${diff.toCreate.length} to create, ${diff.toUpdate.length} to update, ${diff.toDelete.length} to delete, ${totalUnchanged} unchanged…`,
		);
		for (const f of diff.toCreate) this.logger.Log(`  Creating: ${f.path}`);
		for (const f of diff.toUpdate) this.logger.Log(`  Updating: ${f.path}`);
		for (const p of diff.toDelete) this.logger.Log(`  Deleting: ${p}`);
		for (const p of skippedNotForked)
			this.logger.Log(`  Skipped (not forked, but has changes): ${p}`);

		const startMs = Date.now();
		let uploadError: string | null = null;
		try {
			await client.batchUpdateFiles(themeId, toUpsert, diff.toDelete);
		} catch (err) {
			uploadError = err instanceof Error ? err.message : String(err);
			this.logger.Error(`Upload failed: ${uploadError}`);
		}
		const elapsedMs = Date.now() - startMs;

		const skippedSuffix =
			skippedNotForked.length > 0
				? `, skipped (not forked): ${skippedNotForked.length}`
				: "";
		const stats = `created: ${diff.toCreate.length}, updated: ${diff.toUpdate.length}, deleted: ${diff.toDelete.length}, unchanged: ${totalUnchanged}${skippedSuffix}`;
		if (readFailCount > 0 || uploadError !== null) {
			const reasons: string[] = [];
			if (readFailCount > 0)
				reasons.push(`${readFailCount} file(s) could not be read`);
			if (uploadError !== null) reasons.push("upload error");
			throw new CliError(
				`Sync finished with errors in ${elapsedMs}ms (${reasons.join(", ")}) — ${stats}`,
			);
		}
		this.logger.Log(`Sync completed in ${elapsedMs}ms — ${stats}`);
	}

	Bind(command: Command): void {
		const pushCmd = command
			.command("push")
			.description(
				"Upload theme files from the current directory to Nuvemshop/Tiendanube",
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
		addThemePublishedOption(pushCmd);
		addThemeApiTokenOption(pushCmd);
		addHiddenThemeApiUrlOption(pushCmd);
		addHiddenThemeApiHeaderOption(pushCmd);
		pushCmd
			.option("-v", "Enable verbose logging", false)
			.option("--force", "Skip remote comparison and upload all files", false)
			.action(
				runAction((opts: PushOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
