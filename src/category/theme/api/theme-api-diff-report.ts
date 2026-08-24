import { Chalk } from "chalk";
import type { UnifiedDiffNote } from "./theme-api-text-diff";

const chalk = new Chalk();

/** Why a file's content could not be diffed, when it could not. */
export type ThemeDiffEntryNote = UnifiedDiffNote | "content_unavailable";

export type ThemeDiffEntry = {
	path: string;
	/** `json` | `text` | `base64` — see `getThemeFileFormat`. */
	format: string;
	/** `base64` files: no textual diff is possible, only sizes. */
	binary: boolean;
	/** Total line count of the file being added or deleted (text formats only). */
	lines: number | null;
	/** Byte size of the added (local) or deleted (remote) file. */
	sizeBytes: number | null;
	linesAdded: number | null;
	linesRemoved: number | null;
	remoteSizeBytes: number | null;
	localSizeBytes: number | null;
	patch: string | null;
	truncated: boolean;
	note: ThemeDiffEntryNote | null;
	/** Detail for `content_unavailable`. */
	noteDetail: string | null;
};

export type ThemeDiffReport = {
	themeId: string;
	forked: boolean;
	added: ThemeDiffEntry[];
	modified: ThemeDiffEntry[];
	deleted: ThemeDiffEntry[];
	unchangedCount: number;
	/** Theme-code files with local changes that push would skip (not forked). */
	skippedNotForked: string[];
	/** Local files under `custom/`, which push does not support yet. */
	pushUnsupportedCount: number;
	readFailCount: number;
};

export function makeThemeDiffEntry(
	partial: Pick<ThemeDiffEntry, "path" | "format"> & Partial<ThemeDiffEntry>,
): ThemeDiffEntry {
	return {
		binary: partial.format === "base64",
		lines: null,
		sizeBytes: null,
		linesAdded: null,
		linesRemoved: null,
		remoteSizeBytes: null,
		localSizeBytes: null,
		patch: null,
		truncated: false,
		note: null,
		noteDetail: null,
		...partial,
	};
}

export function themeDiffChangeCount(report: ThemeDiffReport): number {
	return report.added.length + report.modified.length + report.deleted.length;
}

/**
 * Whether the local directory matches the remote theme. Stricter than
 * `themeDiffChangeCount === 0`: theme-code files that push would skip still have
 * local changes, and unreadable files have an unknown state, so neither may be
 * reported as clean. `pushUnsupportedCount` is excluded because `custom/` files
 * are never compared in the first place.
 */
export function themeDiffInSync(report: ThemeDiffReport): boolean {
	return (
		themeDiffChangeCount(report) === 0 &&
		report.skippedNotForked.length === 0 &&
		report.readFailCount === 0
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function noteToJson(entry: ThemeDiffEntry): string | null {
	if (entry.note === null) {
		return null;
	}
	if (entry.note === "content_unavailable" && entry.noteDetail !== null) {
		return `content_unavailable: ${entry.noteDetail}`;
	}
	return entry.note;
}

function entryToJson(
	entry: ThemeDiffEntry,
	kind: "added" | "modified" | "deleted",
	detailed: boolean,
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		path: entry.path,
		format: entry.format,
	};
	if (entry.binary) {
		base.binary = true;
	}
	if (kind !== "modified") {
		if (entry.lines !== null) base.lines = entry.lines;
		if (entry.sizeBytes !== null) base.size_bytes = entry.sizeBytes;
	}
	// Line counts and patches require the remote content, which is only fetched
	// under `--detailed`.
	if (!detailed) {
		return base;
	}
	if (kind === "modified") {
		if (entry.linesAdded !== null) base.lines_added = entry.linesAdded;
		if (entry.linesRemoved !== null) base.lines_removed = entry.linesRemoved;
		if (entry.remoteSizeBytes !== null) {
			base.remote_size_bytes = entry.remoteSizeBytes;
		}
		if (entry.localSizeBytes !== null) {
			base.local_size_bytes = entry.localSizeBytes;
		}
	}
	base.truncated = entry.truncated;
	base.note = noteToJson(entry);
	base.patch = entry.patch;
	return base;
}

/**
 * Machine-readable report. `patch` holds a git-compatible unified diff (remote →
 * local) and only appears under `--detailed`.
 */
export function formatThemeDiffJson(
	report: ThemeDiffReport,
	options: { detailed?: boolean } = {},
): string {
	const detailed = options.detailed ?? false;
	const payload = {
		theme_id: report.themeId,
		forked: report.forked,
		detailed,
		in_sync: themeDiffInSync(report),
		summary: {
			added: report.added.length,
			modified: report.modified.length,
			deleted: report.deleted.length,
			unchanged: report.unchangedCount,
			skipped_not_forked: report.skippedNotForked.length,
			skipped_push_unsupported: report.pushUnsupportedCount,
			read_failures: report.readFailCount,
		},
		added: report.added.map((entry) => entryToJson(entry, "added", detailed)),
		modified: report.modified.map((entry) =>
			entryToJson(entry, "modified", detailed),
		),
		deleted: report.deleted.map((entry) =>
			entryToJson(entry, "deleted", detailed),
		),
		skipped_not_forked: report.skippedNotForked,
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}

function padEndVisible(text: string, width: number): string {
	return text.length >= width ? text : text.padEnd(width, " ");
}

/** Colorizes a unified patch and indents it under its file entry. */
function patchLines(patch: string): string[] {
	return patch.split("\n").map((line) => {
		if (line.startsWith("+++") || line.startsWith("---")) {
			return `    ${chalk.dim(line)}`;
		}
		if (line.startsWith("@@")) {
			return `    ${chalk.cyan(line)}`;
		}
		if (line.startsWith("+")) {
			return `    ${chalk.green(line)}`;
		}
		if (line.startsWith("-")) {
			return `    ${chalk.red(line)}`;
		}
		return `    ${chalk.dim(line)}`;
	});
}

function entrySuffix(
	entry: ThemeDiffEntry,
	kind: "added" | "modified" | "deleted",
	detailed: boolean,
): string {
	const parts: string[] = [];
	if (kind === "modified") {
		if (entry.binary) {
			const from =
				entry.remoteSizeBytes === null
					? "?"
					: formatBytes(entry.remoteSizeBytes);
			const to =
				entry.localSizeBytes === null ? "?" : formatBytes(entry.localSizeBytes);
			parts.push(detailed ? `binary, ${from} → ${to}` : "binary");
		} else if (entry.linesAdded !== null && entry.linesRemoved !== null) {
			parts.push(
				`${chalk.green(`+${entry.linesAdded}`)} ${chalk.red(`-${entry.linesRemoved}`)}`,
			);
		}
	} else if (entry.lines !== null) {
		parts.push(`${entry.lines} line${entry.lines === 1 ? "" : "s"}`);
	} else if (entry.binary && entry.sizeBytes !== null) {
		parts.push(`binary, ${formatBytes(entry.sizeBytes)}`);
	}
	if (entry.note === "line_endings_differ") {
		parts.push("line endings only");
	}
	if (entry.note === "content_unavailable") {
		parts.push(
			entry.noteDetail === null
				? "remote content unavailable"
				: `remote content unavailable: ${entry.noteDetail}`,
		);
	}
	if (entry.truncated) {
		parts.push("diff truncated");
	}
	return parts.length === 0 ? "" : parts.join(", ");
}

function sectionLines(
	title: string,
	marker: string,
	colorize: (text: string) => string,
	entries: ThemeDiffEntry[],
	kind: "added" | "modified" | "deleted",
	detailed: boolean,
	pathWidth: number,
): string[] {
	if (entries.length === 0) {
		return [];
	}
	const lines: string[] = ["", chalk.bold(`${title} (${entries.length})`)];
	for (const entry of entries) {
		const suffix = entrySuffix(entry, kind, detailed);
		const label = `  ${colorize(marker)} ${padEndVisible(entry.path, pathWidth)}`;
		lines.push(suffix === "" ? label.trimEnd() : `${label}  ${suffix}`);
		if (detailed && entry.patch !== null && entry.patch !== "") {
			lines.push(...patchLines(entry.patch));
		}
	}
	return lines;
}

/** Console report. `--detailed` appends the colorized unified diff per file. */
export function formatThemeDiffHuman(
	report: ThemeDiffReport,
	options: { detailed?: boolean } = {},
): string {
	const detailed = options.detailed ?? false;
	const changes = themeDiffChangeCount(report);
	const forkLabel = report.forked ? "forked" : "not forked";
	const lines: string[] = [
		chalk.bold(
			`Theme diff for theme ${report.themeId} (${forkLabel}) — ${changes} change${changes === 1 ? "" : "s"}`,
		),
	];

	if (themeDiffInSync(report)) {
		lines.push(chalk.green("No differences — the theme is in sync."));
	}

	const allEntries = [...report.added, ...report.modified, ...report.deleted];
	const pathWidth = allEntries.reduce(
		(width, entry) => Math.max(width, entry.path.length),
		0,
	);

	lines.push(
		...sectionLines(
			"Added",
			"+",
			(text) => chalk.green(text),
			report.added,
			"added",
			detailed,
			pathWidth,
		),
		...sectionLines(
			"Modified",
			"~",
			(text) => chalk.yellow(text),
			report.modified,
			"modified",
			detailed,
			pathWidth,
		),
		...sectionLines(
			"Deleted",
			"-",
			(text) => chalk.red(text),
			report.deleted,
			"deleted",
			detailed,
			pathWidth,
		),
	);

	lines.push("", chalk.dim(`Unchanged: ${report.unchangedCount}`));
	if (report.skippedNotForked.length > 0) {
		lines.push(
			chalk.yellow(
				`Skipped (not forked, but has changes): ${report.skippedNotForked.length}`,
			),
		);
		for (const path of report.skippedNotForked) {
			lines.push(chalk.dim(`  ${path}`));
		}
	}
	if (report.pushUnsupportedCount > 0) {
		lines.push(
			chalk.dim(
				`Skipped (custom/, push not supported yet): ${report.pushUnsupportedCount}`,
			),
		);
	}
	if (report.readFailCount > 0) {
		lines.push(
			chalk.yellow(`Files that could not be read: ${report.readFailCount}`),
		);
	}

	return `${lines.join("\n")}\n`;
}
