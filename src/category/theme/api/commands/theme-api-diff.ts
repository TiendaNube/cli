import path from "node:path";
import type { Command } from "commander";
import { runAction } from "../../../../cli-action";
import { CliError } from "../../../../cli-action";
import { CliLogger } from "../../../../cli-logger";
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
import type { ThemeDiffLocalFile } from "../theme-api-diff";
import { buildThemeDiffPlan } from "../theme-api-diff-plan";
import {
	type ThemeDiffEntry,
	type ThemeDiffReport,
	formatThemeDiffHuman,
	formatThemeDiffJson,
	makeThemeDiffEntry,
} from "../theme-api-diff-report";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	decodeRemoteFileContent,
	getThemeFileFormat,
} from "../theme-api-file-format";
import { fetchRemoteContents } from "../theme-api-remote-content";
import type { RemoteThemeFile } from "../theme-api-response-parsers";
import { computeUnifiedDiff, countTextLines } from "../theme-api-text-diff";

type DiffOptions = {
	themeId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	detailed: boolean;
	v: boolean;
};

/** Local payload as text, or `null` for binary (`base64`) files. */
function localFileAsText(file: ThemeDiffLocalFile): string | null {
	if (file.format === "text") {
		return typeof file.content === "string"
			? file.content
			: String(file.content);
	}
	if (file.format === "json") {
		// Normalize both sides the same way so reformatting alone never shows up.
		return `${JSON.stringify(file.content, null, 2)}\n`;
	}
	return null;
}

function localFileSizeBytes(file: ThemeDiffLocalFile): number | null {
	if (file.format === "base64") {
		return typeof file.content === "string"
			? Buffer.from(file.content, "base64").length
			: null;
	}
	const text = localFileAsText(file);
	return text === null ? null : Buffer.byteLength(text, "utf8");
}

/** Remote payload as text, or `null` for binary (`base64`) files. */
function remoteFileAsText(file: RemoteThemeFile): string | null {
	const decoded = decodeRemoteFileContent(file.content, file.format);
	return Buffer.isBuffer(decoded) ? null : decoded;
}

function remoteFileSizeBytes(file: RemoteThemeFile): number | null {
	const decoded = decodeRemoteFileContent(file.content, file.format);
	return Buffer.isBuffer(decoded)
		? decoded.length
		: Buffer.byteLength(decoded, "utf8");
}

export class ThemeApiDiffCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: DiffOptions, command: Command): Promise<void> {
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
			// JSON mode keeps stdout to the payload alone; the client logs verbose
			// HTTP lines through `console.log`, which would corrupt it.
			verbose: options.v && !options.json,
			extraHeaders,
		});

		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => client,
		});

		// Only human output narrates progress; JSON output keeps stdout to the
		// machine-readable payload alone.
		const notice = (message: string): void => {
			if (!options.json) {
				this.logger.Log(message);
			}
		};

		notice("Comparing local files with the remote theme…");
		const plan = await buildThemeDiffPlan({
			client,
			themeId,
			cwd: path.resolve("./"),
			onNotice: notice,
			onFileError: (message) => this.logger.Error(message),
		});

		const remoteContents = options.detailed
			? await fetchRemoteContents(
					client,
					themeId,
					[
						...plan.diff.toUpdate.map((file) => file.path),
						...plan.diff.toDelete,
					].sort(),
					{ onNotice: notice },
				)
			: {
					files: new Map<string, RemoteThemeFile>(),
					unavailable: new Map<string, string>(),
				};

		const byPath = (a: { path: string }, b: { path: string }): number =>
			a.path.localeCompare(b.path);

		const added: ThemeDiffEntry[] = [...plan.diff.toCreate]
			.sort(byPath)
			.map((file) => {
				const text = localFileAsText(file);
				const entry = makeThemeDiffEntry({
					path: file.path,
					format: file.format,
					lines: text === null ? null : countTextLines(text),
					sizeBytes: localFileSizeBytes(file),
				});
				if (!options.detailed || text === null) {
					return entry;
				}
				const diff = computeUnifiedDiff("", text, {
					oldLabel: "/dev/null",
					newLabel: `local/${file.path}`,
				});
				return {
					...entry,
					patch: diff.patch,
					truncated: diff.truncated,
					linesAdded: diff.linesAdded,
				};
			});

		const modified: ThemeDiffEntry[] = [...plan.diff.toUpdate]
			.sort(byPath)
			.map((file) => {
				const entry = makeThemeDiffEntry({
					path: file.path,
					format: file.format,
					localSizeBytes: localFileSizeBytes(file),
				});
				if (!options.detailed) {
					return entry;
				}
				const remote = remoteContents.files.get(file.path);
				if (remote === undefined) {
					return {
						...entry,
						note: "content_unavailable" as const,
						noteDetail:
							remoteContents.unavailable.get(file.path) ??
							"not returned by the API",
					};
				}
				const withRemoteSize = {
					...entry,
					remoteSizeBytes: remoteFileSizeBytes(remote),
				};
				const localText = localFileAsText(file);
				const remoteText = remoteFileAsText(remote);
				if (localText === null || remoteText === null) {
					// Binary content: sizes are the only meaningful comparison.
					return withRemoteSize;
				}
				const diff = computeUnifiedDiff(remoteText, localText, {
					oldLabel: `remote/${file.path}`,
					newLabel: `local/${file.path}`,
				});
				return {
					...withRemoteSize,
					linesAdded: diff.linesAdded,
					linesRemoved: diff.linesRemoved,
					patch: diff.patch === "" ? null : diff.patch,
					truncated: diff.truncated,
					note: diff.note,
				};
			});

		const deleted: ThemeDiffEntry[] = [...plan.diff.toDelete]
			.sort((a, b) => a.localeCompare(b))
			.map((remotePath) => {
				const format = getThemeFileFormat(remotePath);
				const entry = makeThemeDiffEntry({ path: remotePath, format });
				if (!options.detailed) {
					return entry;
				}
				const remote = remoteContents.files.get(remotePath);
				if (remote === undefined) {
					return {
						...entry,
						note: "content_unavailable" as const,
						noteDetail:
							remoteContents.unavailable.get(remotePath) ??
							"not returned by the API",
					};
				}
				const sizeBytes = remoteFileSizeBytes(remote);
				const remoteText = remoteFileAsText(remote);
				if (remoteText === null) {
					return { ...entry, sizeBytes };
				}
				const diff = computeUnifiedDiff(remoteText, "", {
					oldLabel: `remote/${remotePath}`,
					newLabel: "/dev/null",
				});
				return {
					...entry,
					sizeBytes,
					lines: countTextLines(remoteText),
					linesRemoved: diff.linesRemoved,
					patch: diff.patch,
					truncated: diff.truncated,
				};
			});

		const report: ThemeDiffReport = {
			themeId,
			forked: plan.forked,
			added,
			modified,
			deleted,
			unchangedCount: plan.diff.unchanged + plan.unchangedNonForkedCount,
			skippedNotForked: [...plan.skippedNotForked].sort((a, b) =>
				a.localeCompare(b),
			),
			pushUnsupportedCount: plan.pushUnsupportedCount,
			readFailCount: plan.readFailCount,
		};

		if (options.json) {
			process.stdout.write(
				formatThemeDiffJson(report, { detailed: options.detailed }),
			);
			return;
		}
		process.stdout.write(
			formatThemeDiffHuman(report, { detailed: options.detailed }),
		);
	}

	Bind(command: Command): void {
		const diffCmd = command
			.command("diff")
			.description(
				"Compare local theme files with the remote theme and show what a push would change",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			);
		addThemePublishedOption(diffCmd);
		addThemeApiTokenOption(diffCmd);
		addHiddenThemeApiUrlOption(diffCmd);
		addHiddenThemeApiHeaderOption(diffCmd);
		diffCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option(
				"--detailed",
				"Include a unified diff of the changed parts of each file",
				false,
			)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: DiffOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
