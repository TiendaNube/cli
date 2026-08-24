import crypto from "node:crypto";
import fs from "node:fs";
import { readdirpPromise } from "readdirp";
import { CliError } from "../../../cli-action";
import type { ThemeApiClient } from "./theme-api-client";
import {
	type ThemeDiffLocalFile,
	type ThemeDiffResult,
	computeThemeDiff,
	jsonContentHash,
} from "./theme-api-diff";
import {
	getThemeFileFormat,
	readThemeFileContent,
} from "./theme-api-file-format";
import {
	canPushRelativePathWhenNotForked,
	isInstallationForked,
} from "./theme-api-fork-rules";
import { parseFileHashesResponse } from "./theme-api-response-parsers";
import {
	isPushUnsupported,
	shouldSync,
	themeUploadRelativePath,
} from "./theme-api-workspace-files";

type FileChangeStatus = "changed" | "unchanged";

/**
 * Report-only classifier for files that cannot be pushed (non-forked themes).
 * Unlike `computeThemeDiff` it tolerates a missing remote baseline instead of
 * treating the file as new.
 */
export function computeFileChangeStatus(
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

export type ThemeDiffPlan = {
	/** `forked === true` means the whole theme code may be pushed. */
	forked: boolean;
	diff: ThemeDiffResult;
	/** Remote hashes narrowed to the paths a push would consider. */
	remoteHashes: Map<string, string>;
	/** Unpushable theme-code files (not forked) whose content differs from remote. */
	skippedNotForked: string[];
	/** Unpushable theme-code files (not forked) that match remote. */
	unchangedNonForkedCount: number;
	/** Local files under `custom/`, which push does not support yet. */
	pushUnsupportedCount: number;
	/** Files that could not be read (including empty ones). */
	readFailCount: number;
};

export type BuildThemeDiffPlanParams = {
	client: ThemeApiClient;
	themeId: string;
	/** Theme root, already resolved to an absolute path. */
	cwd: string;
	/** Treat every remote file as different, so a push re-uploads everything. */
	force?: boolean;
	/** Informational messages — callers in `--json` mode should keep these off stdout. */
	onNotice?: (message: string) => void;
	/** Per-file read failures. */
	onFileError?: (message: string) => void;
};

/**
 * Compares the local theme directory with the remote theme and returns what a
 * push would create, update and delete. Shared by `theme push` (which then
 * uploads) and `theme diff` (which only reports).
 */
export async function buildThemeDiffPlan(
	params: BuildThemeDiffPlanParams,
): Promise<ThemeDiffPlan> {
	const { client, themeId, cwd, force = false } = params;
	const notice = params.onNotice ?? ((): void => {});
	const fileError = params.onFileError ?? ((): void => {});

	// Started before the first `await` so it still runs alongside the API calls,
	// but kept out of their `try` so a local traversal failure (EACCES, ENOENT on
	// `cwd`) is not reported as a remote failure. The `catch` is attached here to
	// avoid an unhandled rejection when a remote call rejects first.
	let localScanError: unknown;
	const localScan = readdirpPromise(cwd, {
		alwaysStat: true,
		directoryFilter: (entry) => shouldSync(entry.path),
		fileFilter: (entry) => shouldSync(entry.path),
	})
		.then((entries) => entries.map((e) => e.fullPath))
		.catch((err: unknown) => {
			localScanError = err;
			return [] as string[];
		});

	let installationMeta: unknown;
	let remoteBody: unknown;
	try {
		[installationMeta, remoteBody] = await Promise.all([
			client.getInstallation(themeId),
			client.getFileHashes(themeId),
		]);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new CliError(`Failed to fetch remote data: ${msg}`);
	}

	const filePaths = await localScan;
	if (localScanError !== undefined) {
		const msg =
			localScanError instanceof Error
				? localScanError.message
				: String(localScanError);
		throw new CliError(`Failed to read local theme files: ${msg}`);
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
	let pushUnsupportedCount = 0;
	let pushUnsupportedLogged = false;

	for (const full of filePaths) {
		const rel = themeUploadRelativePath(cwd, full);
		if (rel === null) continue;
		const norm = rel.replace(/\\/g, "/");
		if (norm === "manifest.json") continue;
		if (isPushUnsupported(norm)) {
			pushUnsupportedCount += 1;
			if (!pushUnsupportedLogged) {
				notice(
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
				fileError(`  ${norm}: Empty file (0 bytes), skipped`);
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
			fileError(`  Failed to read ${norm}: ${msg}`);
		}
	}

	// `--force`: keep the remote paths (so deletions are still computed) but void
	// their hashes, which lands every local file in `toUpdate`.
	const effectiveRemote = force
		? new Map([...remoteFiltered.keys()].map((p) => [p, ""]))
		: remoteFiltered;

	return {
		forked,
		diff: computeThemeDiff(localFiles, effectiveRemote),
		remoteHashes: remoteFiltered,
		skippedNotForked,
		unchangedNonForkedCount,
		pushUnsupportedCount,
		readFailCount,
	};
}
