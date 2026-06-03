import path from "node:path";
import { UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX } from "./slot-catalog";

export type SlotReportSummary = {
	tplFilesAnalyzed: number;
	durationMs: number;
	/** Instant when the report was finalized, ISO 8601 UTC (e.g. `Date.prototype.toISOString()`). */
	reportTimestampIso: string;
};

/**
 * Normalizes a report file name (basename only; any directory segment is ignored).
 * Ensures a `.md` extension (replaces other extensions). Returns empty string if invalid.
 */
export function NormalizeMarkdownFileName(fileName: string): string {
	const base = path.basename(fileName.trim());
	if (!base || base === "." || base === "..") {
		return "";
	}
	const ext = path.extname(base).toLowerCase();
	if (ext === ".md") {
		return base;
	}
	const stem = path.basename(base, path.extname(base));
	if (!stem) {
		return "";
	}
	return `${stem}.md`;
}

function FormatDurationSeconds(durationMs: number): string {
	return (durationMs / 1000).toFixed(2);
}

/** One-line summary for the console. */
export function FormatSlotReportSummaryLines(
	summary: SlotReportSummary,
): string[] {
	const s = FormatDurationSeconds(summary.durationMs);
	const n = summary.tplFilesAnalyzed;
	const fileWord = n === 1 ? "file" : "files";
	return [
		`Generated at: ${summary.reportTimestampIso}`,
		`Summary: ${n} .tpl ${fileWord} analyzed in ${s} s`,
	];
}

/** Markdown block for the report footer. */
export function BuildMarkdownSummarySection(
	summary: SlotReportSummary,
): string {
	const s = FormatDurationSeconds(summary.durationMs);
	return [
		"## Summary",
		"",
		`- Generated at: ${summary.reportTimestampIso}`,
		`- .tpl files analyzed: ${summary.tplFilesAnalyzed}`,
		`- Execution time: ${s} s`,
		"",
	].join("\n");
}

/** GFM checklist: present `[x]`, missing `[ ]`. */
export function BuildSlotsMarkdownReport(
	slotNamesSorted: string[],
	found: Set<string>,
	options?: {
		title?: string;
		summary?: SlotReportSummary;
		directCanonical?: Set<string>;
		legacyDomByCanonical?: Map<string, string>;
		indirectViaProductItemImage?: Set<string>;
	},
): string {
	const title = options?.title ?? "# Slots Report";
	const direct = options?.directCanonical;
	const legacyMap = options?.legacyDomByCanonical;
	const indirectPii = options?.indirectViaProductItemImage;
	const lines = slotNamesSorted.map((s) => {
		if (!found.has(s)) {
			return `- [ ] ${s}`;
		}
		if (legacyMap?.has(s) && direct && !direct.has(s)) {
			const legacy = legacyMap.get(s) ?? "";
			return `- [x] ${s} (deprecated DOM alias: \`${legacy}\`)`;
		}
		if (indirectPii?.has(s) && direct && !direct.has(s)) {
			return `- [x] ${s} (via platform component product-item-image)`;
		}
		return `- [x] ${s}`;
	});
	let body = `${title}\n\n${lines.join("\n")}\n`;
	const unknownRefs = [...found]
		.filter((s) => s.startsWith(UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX))
		.sort((a, b) => a.localeCompare(b));
	if (unknownRefs.length > 0) {
		const listed = unknownRefs.map((s) => {
			const raw = s.slice(UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX.length);
			return `- ${raw}`;
		});
		body += `\n## Unresolved slot references in theme\n\n${listed.join("\n")}\n`;
	}
	if (options?.summary) {
		body += `\n${BuildMarkdownSummarySection(options.summary)}`;
	}
	return body;
}
