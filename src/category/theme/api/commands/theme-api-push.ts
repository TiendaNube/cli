import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { Option } from "commander";
import { readdirpPromise } from "readdirp";
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
import {
	type ThemeDiffLocalFile,
	computeThemeDiff,
	jsonContentHash,
} from "../theme-api-diff";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	getThemeFileFormat,
	readThemeFileContent,
} from "../theme-api-file-format";
import {
	canPushRelativePathWhenNotForked,
	isInstallationForked,
} from "../theme-api-fork-rules";
import { parseFileHashesResponse } from "../theme-api-response-parsers";
import {
	isPushUnsupported,
	shouldSync,
	themeUploadRelativePath,
} from "../theme-api-workspace-files";

type FileChangeStatus = "changed" | "unchanged";

function computeFileChangeStatus(
	norm: string,
	rawBytes: Buffer,
	remoteHashMap: Map<string, string>,
): FileChangeStatus {
	const remoteHash = remoteHashMap.get(norm);

	// File doesn't exist remotely — no baseline to compare, so nothing has "changed"
	// from the remote's perspective. We count it as unchanged to avoid false positives.
	if (remoteHash === undefined) return "unchanged";

	const localHash = crypto.createHash("md5").update(rawBytes).digest("hex");

	// Fast path: raw byte content is identical, no need for further checks.
	if (localHash === remoteHash) return "unchanged";

	// For JSON files, the raw MD5 may differ even when the semantic content is the same.
	// The remote stores hashes produced by PHP's json_encode, which enforces its own key
	// ordering and whitespace. A file formatted locally by a different tool (e.g. Prettier)
	// will produce a different raw MD5 but should not be reported as changed.
	// jsonContentHash replicates PHP's serialisation so we can compare apples to apples.
	if (getThemeFileFormat(norm) === "json") {
		try {
			const localJson = JSON.parse(rawBytes.toString("utf8"));
			const phpHash = jsonContentHash(localJson);
			if (phpHash === remoteHash) return "unchanged";
		} catch {
			// Not valid JSON — fall through and treat as changed.
		}
	}

	return "changed";
}

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
		let installationMeta: unknown;
		let filePaths: string[];
		let remoteBody: unknown;
		try {
			[installationMeta, filePaths, remoteBody] = await Promise.all([
				client.getInstallation(themeId),
				readdirpPromise(cwd, {
					alwaysStat: true,
					directoryFilter: (entry) => shouldSync(entry.path),
					fileFilter: (entry) => shouldSync(entry.path),
				}).then((entries) => entries.map((e) => e.fullPath)),
				client.getFileHashes(themeId),
			]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new CliError(`Failed to fetch remote data: ${msg}`);
		}

		const forked = isInstallationForked(installationMeta);
		const remoteHashMap = parseFileHashesResponse(remoteBody);

		const remoteFiltered = new Map(
			[...remoteHashMap].filter(([p]) => {
				if (p === "manifest.json") return false;
				if (!shouldSync(p)) return false;
				if (isPushUnsupported(p)) return false;
				if (!forked && !canPushRelativePathWhenNotForked(p)) return false;
				return true;
			}),
		);

		const localFiles: ThemeDiffLocalFile[] = [];
		let readFailCount = 0;
		const skippedNotForked: string[] = [];
		let unchangedNonForkedCount = 0;
		let pushUnsupportedLogged = false;

		for (const full of filePaths) {
			const rel = themeUploadRelativePath(cwd, full);
			if (rel === null) continue;
			const norm = rel.replace(/\\/g, "/");
			if (norm === "manifest.json") continue;
			if (isPushUnsupported(norm)) {
				if (!pushUnsupportedLogged) {
					this.logger.Log(
						"  Skipping custom/ files: push is not yet supported for this folder",
					);
					pushUnsupportedLogged = true;
				}
				continue;
			}

			const canPush = forked || canPushRelativePathWhenNotForked(norm);

			if (!canPush) {
				try {
					const rawBytes = fs.readFileSync(full);
					if (rawBytes.length === 0) continue;
					const status = computeFileChangeStatus(norm, rawBytes, remoteHashMap);
					if (status === "changed") {
						skippedNotForked.push(norm);
					} else {
						unchangedNonForkedCount += 1;
					}
				} catch {
					// silently ignore read errors for non-pushable files
				}
				continue;
			}

			try {
				const rawBytes = fs.readFileSync(full);
				if (rawBytes.length === 0) {
					this.logger.Error(`  ${norm}: Empty file (0 bytes), skipped`);
					readFailCount += 1;
					continue;
				}
				const format = getThemeFileFormat(norm);
				const content = readThemeFileContent(full, format);
				const hash =
					format === "json"
						? jsonContentHash(content)
						: crypto.createHash("md5").update(rawBytes).digest("hex");
				localFiles.push({ path: norm, full, format, content, hash });
			} catch (err) {
				readFailCount += 1;
				const msg = err instanceof Error ? err.message : String(err);
				this.logger.Error(`  Failed to read ${norm}: ${msg}`);
			}
		}

		const effectiveRemote = options.force
			? new Map([...remoteFiltered.keys()].map((p) => [p, ""]))
			: remoteFiltered;

		const diff = computeThemeDiff(localFiles, effectiveRemote);
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
