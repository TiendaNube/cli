import fs from "node:fs";
import path from "node:path";
import { Chalk } from "chalk";
import type { Command } from "commander";
import { CliLogger } from "../../../cli-logger";
import { ScanThemeForNubesdkSlots } from "../scan-theme-slots";
import {
	GetAllSlotNamesSorted,
	LoadSlotCatalog,
	UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX,
} from "../slot-catalog";
import {
	BuildSlotsMarkdownReport,
	FormatSlotReportSummaryLines,
	NormalizeMarkdownFileName,
} from "../slots-markdown-report";
import {
	FormatTplScanProgressLine,
	TplScanProgressPercent,
} from "../tpl-scan-progress";

type ValidateOptions = {
	dir?: string;
	outputFile?: string;
};

export class NubesdkValidateSlotsCommand {
	private logger = new CliLogger();
	private chalk = new Chalk();

	Bind(command: Command): void {
		command
			.command("validate-slots")
			.description(
				"Scan .tpl files under the theme directory and report NubeSDK slot coverage",
			)
			.option("--dir <dir>", "Theme root (default: current working directory)")
			.option(
				"--output-file <output_file>",
				"File name for a Markdown checklist written under the theme directory (.md added if missing)",
			)
			.action(async (options: ValidateOptions) => {
				await this.Execute(options);
			});
	}

	private async Execute(options: ValidateOptions): Promise<void> {
		const themeRoot = path.resolve(options.dir ?? process.cwd());
		let stat: fs.Stats;
		try {
			stat = fs.statSync(themeRoot);
		} catch {
			this.logger.Error(`Directory not found: ${themeRoot}`);
			process.exitCode = 1;
			return;
		}
		if (!stat.isDirectory()) {
			this.logger.Error(`Not a directory: ${themeRoot}`);
			process.exitCode = 1;
			return;
		}

		const catalog = LoadSlotCatalog();
		const allSlots = GetAllSlotNamesSorted(catalog);

		const started = performance.now();
		const progressTTY = process.stdout.isTTY === true;

		const {
			found,
			directCanonical,
			legacyDomByCanonical,
			indirectViaProductItemImage,
			tplFilesAnalyzed,
		} = await ScanThemeForNubesdkSlots(
			themeRoot,
			catalog,
			progressTTY
				? (done, total) => {
						const pct = TplScanProgressPercent(done, total);
						const line = FormatTplScanProgressLine(pct);
						process.stdout.write(`\r\x1b[K${line}`);
					}
				: () => {},
		);

		if (progressTTY) {
			process.stdout.write("\r\x1b[K");
		}

		for (const slot of allSlots) {
			const satisfied = found.has(slot);
			if (!satisfied) {
				console.log(`${this.chalk.red("[Missing]")} ${slot}`);
				continue;
			}
			if (legacyDomByCanonical.has(slot) && !directCanonical.has(slot)) {
				const legacy = legacyDomByCanonical.get(slot) ?? "";
				console.log(
					`${this.chalk.yellow("[OK/Deprecated]")} ${legacy} -> Recommended to replace with new name ${slot}`,
				);
				continue;
			}
			if (indirectViaProductItemImage.has(slot) && !directCanonical.has(slot)) {
				console.log(
					`${this.chalk.cyan("[OK]")} ${slot} (via platform component product-item-image)`,
				);
				continue;
			}
			console.log(`${this.chalk.green("[OK]")} ${slot}`);
		}

		const unknownInTheme = [...found]
			.filter((s) => s.startsWith(UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX))
			.sort((a, b) => a.localeCompare(b));
		for (const entry of unknownInTheme) {
			const id = entry.slice(UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX.length);
			console.log(
				`${this.chalk.yellow("[Unknown]")} ${id} (not in catalog / unresolvable type)`,
			);
		}

		const durationMs = performance.now() - started;
		const reportTimestampIso = new Date().toISOString();
		const summary = { tplFilesAnalyzed, durationMs, reportTimestampIso };

		if (options.outputFile) {
			const mdName = NormalizeMarkdownFileName(options.outputFile);
			if (!mdName) {
				this.logger.Error(
					"Invalid --output-file: use a non-empty file name (e.g. slots-report).",
				);
				process.exitCode = 1;
			} else {
				const outPath = path.join(themeRoot, mdName);
				const md = BuildSlotsMarkdownReport(allSlots, found, {
					title: "# Theme slots",
					summary,
					directCanonical,
					legacyDomByCanonical,
					indirectViaProductItemImage,
				});
				try {
					fs.writeFileSync(outPath, md, "utf8");
					this.logger.Log(`Markdown report written to ${outPath}`);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					this.logger.Error(
						`Failed to write Markdown report to ${outPath}: ${msg}`,
					);
					process.exitCode = 1;
				}
			}
		}

		for (const line of FormatSlotReportSummaryLines(summary)) {
			console.log(line);
		}
	}
}
