import path from "node:path";
import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { writeJsonOutput } from "../../../../json-output";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import { ThemeFtpTools } from "../theme-ftp-tools";

type DiffOptions = {
	json: boolean;
	force: boolean;
	v: boolean;
};

/** `added`/`modified`/`deleted` mirror the Public API diff's vocabulary. */
type FtpDiffReport = {
	added: string[];
	modified: string[];
	deleted: string[];
	skippedEmpty: string[];
	unchangedCount: number;
	comparedBy: "size+mtime";
};

/**
 * `ComputeDiff` returns absolute local paths for uploads and remote-rooted paths
 * for deletions. Emitting either shape raw would leak the user's home directory
 * into an agent's context, so both are normalized to workspace-relative here.
 */
function toWorkspaceRelative(cwd: string, absoluteLocalPath: string): string {
	const relative = ThemeFtpTools.themeUploadRelativePath(
		cwd,
		absoluteLocalPath,
	);
	return (relative ?? path.basename(absoluteLocalPath)).replace(/\\/g, "/");
}

function stripLeadingSlashes(remotePath: string): string {
	return remotePath.replace(/^\/+/, "");
}

function formatHuman(report: FtpDiffReport): string {
	const lines: string[] = [];
	const section = (title: string, paths: string[]): void => {
		if (paths.length === 0) {
			return;
		}
		lines.push(`${title} (${paths.length}):`);
		for (const entry of paths) {
			lines.push(`  ${entry}`);
		}
		lines.push("");
	};

	section("Added", report.added);
	section("Modified", report.modified);
	section("Deleted from the remote theme", report.deleted);
	section("Skipped, empty files are never uploaded", report.skippedEmpty);

	lines.push(
		`${report.added.length} to add, ${report.modified.length} to modify, ${report.deleted.length} to delete (${report.unchangedCount} unchanged).`,
	);
	if (
		report.added.length === 0 &&
		report.modified.length === 0 &&
		report.deleted.length === 0
	) {
		lines.push(
			report.skippedEmpty.length === 0
				? "Nothing to push."
				: `Nothing to push, but ${report.skippedEmpty.length} empty file(s) differ from the remote and will not be uploaded.`,
		);
	}
	// Sizes and timestamps are all FTP exposes, so a same-size same-mtime edit
	// reads as unchanged. Say so rather than let it look like a full comparison.
	lines.push("Compared by file size and modification time, not by content.");
	return `${lines.join("\n")}\n`;
}

export class ThemeFtpDiffCommand {
	private logger = new CliLogger();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: DiffOptions): Promise<void> {
		if (!this.config.IsSet()) {
			throw new CliError(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
		}

		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}

		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		// JSON mode keeps stdout to the payload alone; basic-ftp's verbose tracing
		// writes there too, which would corrupt it.
		ftpConfig.verbose = options.v && !options.json;
		const client = new ThemeFtpClient(ftpConfig);

		const diff = await client.ComputeDiff(options.force, {
			onNotice: options.json ? () => {} : (m) => this.logger.Log(m),
		});
		if (!diff.success) {
			throw new CliError(`Diff failed: ${diff.errorMessage}`);
		}

		const cwd = path.resolve("./");
		const relativeSorted = (absolutePaths: string[]): string[] =>
			absolutePaths
				.map((absolute) => toWorkspaceRelative(cwd, absolute))
				.sort((a, b) => a.localeCompare(b));

		const report: FtpDiffReport = {
			added: relativeSorted(diff.toCreate),
			modified: relativeSorted(diff.toUpdate),
			deleted: diff.toDelete
				.map(stripLeadingSlashes)
				.sort((a, b) => a.localeCompare(b)),
			skippedEmpty: relativeSorted(diff.skippedEmpty),
			unchangedCount: diff.unchangedCount,
			comparedBy: "size+mtime",
		};

		if (options.json) {
			writeJsonOutput(`${JSON.stringify(report, null, 2)}\n`);
			return;
		}
		process.stdout.write(formatHuman(report));
	}

	Bind(command: Command): void {
		command
			.command("diff")
			.description(
				"Compare local files with the remote theme over FTP and show what a push would change",
			)
			.option("--json", "Use machine-readable JSON output", false)
			.option(
				"--force",
				"Preview a forced push, which uploads every file regardless of comparison",
				false,
			)
			.option("-v", "Enable verbose logging", false)
			.action(runAction((options: DiffOptions) => this.Execute(options)));
	}
}
