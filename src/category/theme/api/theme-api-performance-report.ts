import { Chalk } from "chalk";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lighthouse form factors the CLI audits, in the order they are reported. */
export type PerformanceDevice = "mobile" | "desktop";

export const PERFORMANCE_DEVICES: readonly PerformanceDevice[] = [
	"mobile",
	"desktop",
];

/** Title-cased device name for human output ("mobile" -> "Mobile"). */
export function deviceLabel(device: PerformanceDevice): string {
	return device === "mobile" ? "Mobile" : "Desktop";
}

/**
 * Lighthouse audit ids surfaced by `theme performance`, in display order. Any id
 * that Lighthouse does not return (e.g. a metric dropped in a future version) is
 * simply skipped, so this list is safe to keep broad.
 */
export const PERFORMANCE_METRIC_AUDITS: ReadonlyArray<{
	id: string;
	label: string;
}> = [
	{ id: "first-contentful-paint", label: "First Contentful Paint" },
	{ id: "speed-index", label: "Speed Index" },
	{ id: "largest-contentful-paint", label: "Largest Contentful Paint" },
	{ id: "total-blocking-time", label: "Total Blocking Time" },
	{ id: "cumulative-layout-shift", label: "Cumulative Layout Shift" },
	{ id: "interactive", label: "Time to Interactive" },
];

export type PerformanceMetric = {
	id: string;
	label: string;
	/** Human-readable value as formatted by Lighthouse (e.g. "1.2 s", "0.02"). */
	displayValue: string;
	/** Raw numeric value (milliseconds for time metrics), or null when absent. */
	numericValue: number | null;
	/** Lighthouse audit score in the 0..1 range, or null when absent. */
	score: number | null;
};

/**
 * Lighthouse performance-category groups that hold actionable recommendations
 * (as opposed to `metrics`, which we surface separately, and `hidden`).
 * `load-opportunities` is the pre-v13 name kept for forward/backward safety.
 */
const RECOMMENDATION_GROUPS = new Set([
	"insights",
	"diagnostics",
	"load-opportunities",
]);

/** Lighthouse's own pass threshold: audits scoring at/above this are "green". */
const RECOMMENDATION_PASS_THRESHOLD = 0.9;

/** How many concrete example items to surface per recommendation. */
const RECOMMENDATION_EXAMPLE_LIMIT = 3;

/** Max characters for an example label before it is middle-truncated. */
const EXAMPLE_LABEL_MAX = 100;

export type PerformanceRecommendationExample = {
	/** The offending resource URL or DOM-element locator. */
	label: string;
	/** Per-item impact, e.g. "102 KiB" or "314 ms" (empty when unknown). */
	detail: string;
};

export type PerformanceRecommendation = {
	id: string;
	/** Imperative audit title, e.g. "Reduce unused JavaScript". */
	title: string;
	/** Plain-text description (markdown links flattened to `text (url)`). */
	description: string;
	/** Documentation link pulled from the description, or null when absent. */
	learnMoreUrl: string | null;
	/** Lighthouse's short impact summary, e.g. "Est savings of 46 KiB". */
	displayValue: string;
	/** Failing audit score in the 0..1 range. */
	score: number | null;
	/** Best-effort estimated load-time savings in ms, or null when unknown. */
	estimatedSavingsMs: number | null;
	/** Concrete offending items (URLs/elements), capped at the example limit. */
	examples: PerformanceRecommendationExample[];
	/** Total offending items in the report (>= examples.length). */
	totalItems: number;
};

export type ThemePerformanceReport = {
	/** Which Lighthouse form factor produced this report. */
	device: PerformanceDevice;
	themeId: string;
	/** The storefront preview URL that was requested. */
	url: string;
	/** URL Lighthouse actually audited (after redirects), or null when unknown. */
	finalUrl: string | null;
	/** Overall performance score 0..100, or null when Lighthouse omitted it. */
	performanceScore: number | null;
	metrics: PerformanceMetric[];
	/** Failing opportunities/diagnostics, worst impact first (for `--detailed`). */
	recommendations: PerformanceRecommendation[];
};

function extractFinalUrl(lhr: Record<string, unknown>): string | null {
	// Lighthouse renamed this field across versions; accept the current name and
	// the legacy ones so the report keeps working whichever shape is returned.
	for (const key of ["finalDisplayedUrl", "finalUrl", "requestedUrl"]) {
		const value = lhr[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

/** Flattens Lighthouse markdown descriptions to single-line plain text. */
function cleanRecommendationDescription(description: unknown): string {
	if (typeof description !== "string") {
		return "";
	}
	return description
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // [text](url) -> text (url)
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Pulls the documentation link out of a Lighthouse description. Descriptions can
 * contain several markdown links; the canonical "Learn more" doc link is the
 * last one, so we return that.
 */
function extractLearnMoreUrl(description: unknown): string | null {
	if (typeof description !== "string") {
		return null;
	}
	const linkPattern = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g;
	let lastUrl: string | null = null;
	let match: RegExpExecArray | null = linkPattern.exec(description);
	while (match !== null) {
		lastUrl = match[1] ?? lastUrl;
		match = linkPattern.exec(description);
	}
	return lastUrl;
}

function formatBytes(bytes: number): string {
	const kib = bytes / 1024;
	return kib >= 1024
		? `${(kib / 1024).toFixed(1)} MiB`
		: `${Math.round(kib)} KiB`;
}

/** Middle-truncates long labels (e.g. URLs) so both host and filename survive. */
function truncateLabel(text: string): string {
	if (text.length <= EXAMPLE_LABEL_MAX) {
		return text;
	}
	const head = Math.ceil((EXAMPLE_LABEL_MAX - 1) / 2);
	const tail = Math.floor((EXAMPLE_LABEL_MAX - 1) / 2);
	return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** A DOM-element locator from a `node`-typed value: selector, label, or snippet. */
function nodeLocator(node: Record<string, unknown>): string | null {
	for (const key of ["selector", "nodeLabel", "snippet"]) {
		const value = node[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return truncateLabel(value.trim().replace(/\s+/g, " "));
		}
	}
	if (typeof node.url === "string" && node.url.trim().length > 0) {
		return truncateLabel(node.url.trim());
	}
	return null;
}

/**
 * A single-line locator for a details row: its URL/origin, else its DOM element
 * (in `node` or `source`), else a descriptive text field (e.g. a checklist label).
 */
function exampleLabel(item: Record<string, unknown>): string | null {
	for (const key of ["url", "origin"]) {
		const value = item[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return truncateLabel(value.trim());
		}
	}
	for (const key of ["node", "source"]) {
		const value = item[key];
		if (isRecord(value)) {
			const locator = nodeLocator(value);
			if (locator) {
				return locator;
			}
		}
	}
	// Fallbacks for audits whose rows are neither a URL nor an element (e.g. the
	// checklist rows of "Document request latency").
	for (const key of ["reason", "statistic", "label"]) {
		const value = item[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return truncateLabel(value.trim());
		}
	}
	return null;
}

function bytesTextOrEmpty(bytes: number): string {
	// Below ~1 KiB the impact is negligible; show no unit rather than "0 KiB".
	return Math.round(bytes / 1024) >= 1 ? formatBytes(bytes) : "";
}

type MetricUnit = "bytes" | "ms";

/** Item fields that carry each unit, tried in order of preference. */
const METRIC_FIELDS: Record<MetricUnit, readonly string[]> = {
	bytes: ["wastedBytes", "totalBytes"],
	ms: ["wastedMs"],
};

/** Whether an audit's summary (`displayValue`) is expressed in bytes or time. */
function unitFromDisplayValue(displayValue: string): MetricUnit | null {
	const value = displayValue.toLowerCase();
	if (/\d[\d.,]*\s*(kib|mib|gib|kb|mb|gb|bytes|\bb\b)/.test(value)) {
		return "bytes";
	}
	if (/\bms\b/.test(value) || /\d[\d.,]*\s*s\b/.test(value)) {
		return "ms";
	}
	return null;
}

/**
 * Picks ONE impact field for the whole audit so every example is ranked and
 * displayed with the same metric — the one the audit's title reports (e.g. an
 * "Est savings of … ms" title ranks its rows by `wastedMs`). Falls back to
 * whichever savings field the rows carry when the title has no recognizable unit.
 */
function chooseExampleMetric(
	displayValue: string,
	items: unknown[],
): { field: string; unit: MetricUnit } | null {
	const titleUnit = unitFromDisplayValue(displayValue);
	const candidates: Array<{ field: string; unit: MetricUnit }> = titleUnit
		? METRIC_FIELDS[titleUnit].map((field) => ({ field, unit: titleUnit }))
		: [
				{ field: "wastedBytes", unit: "bytes" },
				{ field: "wastedMs", unit: "ms" },
				{ field: "totalBytes", unit: "bytes" },
			];
	for (const candidate of candidates) {
		const present = items.some(
			(item) => isRecord(item) && typeof item[candidate.field] === "number",
		);
		if (present) {
			return candidate;
		}
	}
	return null;
}

function formatMetric(value: number, unit: MetricUnit): string {
	if (unit === "bytes") {
		return bytesTextOrEmpty(value);
	}
	const ms = Math.round(value);
	return ms >= 1 ? `${ms} ms` : "";
}

/**
 * Flattens an audit's `details` into a flat list of row records, regardless of
 * how the audit nests them. Handles the common shapes:
 *  - a plain `items` array (opportunity / table audits);
 *  - an `items` object keyed by check name (the "checklist" insight);
 *  - `list` sections whose real rows live under `section.value.items` (nested
 *    tables) or `section.value.chains` (the network request tree).
 */
function collectDetailRows(
	details: Record<string, unknown> | null,
): Record<string, unknown>[] {
	if (!details) {
		return [];
	}
	const rows: Record<string, unknown>[] = [];
	const addChains = (chains: Record<string, unknown>): void => {
		for (const chain of Object.values(chains)) {
			if (!isRecord(chain)) {
				continue;
			}
			rows.push(chain);
			if (isRecord(chain.children)) {
				addChains(chain.children);
			}
		}
	};
	const addRow = (row: unknown): void => {
		if (!isRecord(row)) {
			return;
		}
		// A `list-section` wraps a nested table or network tree in `value`.
		if (isRecord(row.value)) {
			if (Array.isArray(row.value.items)) {
				for (const nested of row.value.items) {
					addRow(nested);
				}
				return;
			}
			if (isRecord(row.value.chains)) {
				addChains(row.value.chains);
				return;
			}
		}
		rows.push(row);
	};
	const { items } = details;
	if (Array.isArray(items)) {
		for (const item of items) {
			addRow(item);
		}
	} else if (isRecord(items)) {
		// Checklist: an object keyed by check name.
		for (const item of Object.values(items)) {
			addRow(item);
		}
	}
	return rows;
}

/** Finds the request-chains object of a network-dependency-tree audit, if any. */
function findNetworkChains(
	details: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!details || !Array.isArray(details.items)) {
		return null;
	}
	for (const section of details.items) {
		if (
			isRecord(section) &&
			isRecord(section.value) &&
			isRecord(section.value.chains)
		) {
			return section.value.chains;
		}
	}
	return null;
}

function chainUrl(chain: Record<string, unknown>): string {
	return typeof chain.url === "string" && chain.url.trim().length > 0
		? truncateLabel(chain.url.trim())
		: "(request)";
}

/** Renders a chain's descendants as indented tree lines with ├─ / └─ connectors. */
function renderChainChildren(
	children: Record<string, unknown>,
	indent: string,
): string[] {
	const nodes = Object.values(children).filter(isRecord);
	const lines: string[] = [];
	nodes.forEach((node, index) => {
		const isLast = index === nodes.length - 1;
		lines.push(`${indent}${isLast ? "└─" : "├─"} ${chainUrl(node)}`);
		if (isRecord(node.children)) {
			const childIndent = `${indent}${isLast ? "   " : "│  "}`;
			lines.push(...renderChainChildren(node.children, childIndent));
		}
	});
	return lines;
}

/** A root chain as a multi-line tree: root URL first, then its descendants. */
function renderChainTree(root: Record<string, unknown>): string {
	const lines = [chainUrl(root)];
	if (isRecord(root.children)) {
		lines.push(...renderChainChildren(root.children, ""));
	}
	return lines.join("\n");
}

/**
 * Builds one example per root request chain — each a tree of the chained URLs,
 * ranked by the chain's end time so the longest chains surface first.
 */
function extractChainExamples(chains: Record<string, unknown>): {
	examples: PerformanceRecommendationExample[];
	totalItems: number;
} {
	const ranked = Object.values(chains)
		.filter(isRecord)
		.map((root) => {
			const ms =
				typeof root.navStartToEndTime === "number"
					? Math.round(root.navStartToEndTime)
					: 0;
			return {
				label: renderChainTree(root),
				detail: ms >= 1 ? `${ms} ms` : "",
				impact: ms,
			};
		});
	ranked.sort((a, b) => b.impact - a.impact);
	const examples = ranked
		.slice(0, RECOMMENDATION_EXAMPLE_LIMIT)
		.map(({ label, detail }) => ({ label, detail }));
	return { examples, totalItems: ranked.length };
}

/**
 * Pulls concrete offending items from an audit's details. Network-dependency-tree
 * audits render each root request chain as a tree; every other audit yields flat
 * URL/element rows, measured with the single metric chosen for the audit and
 * sorted by descending impact. Returns the capped example list plus the total
 * number of rows found.
 */
function extractExamples(audit: Record<string, unknown>): {
	examples: PerformanceRecommendationExample[];
	totalItems: number;
} {
	const details = isRecord(audit.details) ? audit.details : null;
	const chains = findNetworkChains(details);
	if (chains) {
		return extractChainExamples(chains);
	}
	const rows = collectDetailRows(details);
	const displayValue =
		typeof audit.displayValue === "string" ? audit.displayValue : "";
	const metric = chooseExampleMetric(displayValue, rows);
	const labelled: (PerformanceRecommendationExample & { impact: number })[] =
		[];
	for (const row of rows) {
		// Skip passing checklist checks (`value: true`); keep failing ones.
		if (row.value === true) {
			continue;
		}
		const label = exampleLabel(row);
		if (label === null) {
			continue;
		}
		const raw = metric ? row[metric.field] : undefined;
		const value = typeof raw === "number" ? raw : 0;
		const detail = metric ? formatMetric(value, metric.unit) : "";
		labelled.push({ label, detail, impact: value });
	}
	// Stable sort keeps Lighthouse's original order among equally-impactful rows.
	labelled.sort((a, b) => b.impact - a.impact);
	const examples = labelled
		.slice(0, RECOMMENDATION_EXAMPLE_LIMIT)
		.map(({ label, detail }) => ({ label, detail }));
	return { examples, totalItems: labelled.length };
}

/**
 * Best-effort estimated savings in ms: the legacy opportunity `overallSavingsMs`
 * when present, otherwise the largest per-metric saving from `metricSavings`.
 */
function estimateSavingsMs(audit: Record<string, unknown>): number | null {
	const details = isRecord(audit.details) ? audit.details : null;
	if (details && typeof details.overallSavingsMs === "number") {
		return Math.round(details.overallSavingsMs);
	}
	const metricSavings = isRecord(audit.metricSavings)
		? audit.metricSavings
		: null;
	if (metricSavings) {
		const values = Object.values(metricSavings).filter(
			(value): value is number => typeof value === "number",
		);
		if (values.length > 0) {
			return Math.round(Math.max(...values));
		}
	}
	return null;
}

/**
 * Collects the failing opportunity/diagnostic audits from the performance
 * category, ordered by estimated impact (largest savings first, then worst
 * score). Passing, informative, and not-applicable audits are excluded.
 */
function extractRecommendations(
	performance: Record<string, unknown>,
	audits: Record<string, unknown>,
): PerformanceRecommendation[] {
	const auditRefs = Array.isArray(performance.auditRefs)
		? performance.auditRefs
		: [];
	const recommendations: PerformanceRecommendation[] = [];
	for (const ref of auditRefs) {
		if (!isRecord(ref)) {
			continue;
		}
		if (
			typeof ref.group !== "string" ||
			!RECOMMENDATION_GROUPS.has(ref.group)
		) {
			continue;
		}
		if (typeof ref.id !== "string") {
			continue;
		}
		const audit = audits[ref.id];
		if (!isRecord(audit)) {
			continue;
		}
		const score = typeof audit.score === "number" ? audit.score : null;
		// Only actionable audits: scored and below Lighthouse's pass threshold.
		if (score === null || score >= RECOMMENDATION_PASS_THRESHOLD) {
			continue;
		}
		const { examples, totalItems } = extractExamples(audit);
		recommendations.push({
			id: ref.id,
			title: typeof audit.title === "string" ? audit.title : ref.id,
			description: cleanRecommendationDescription(audit.description),
			learnMoreUrl: extractLearnMoreUrl(audit.description),
			displayValue:
				typeof audit.displayValue === "string" ? audit.displayValue : "",
			score,
			estimatedSavingsMs: estimateSavingsMs(audit),
			examples,
			totalItems,
		});
	}
	recommendations.sort(
		(a, b) =>
			(b.estimatedSavingsMs ?? 0) - (a.estimatedSavingsMs ?? 0) ||
			(a.score ?? 0) - (b.score ?? 0),
	);
	return recommendations;
}

/**
 * Distills a Lighthouse Result (`lhr`) into the performance-only shape the CLI
 * reports. Parses defensively (the input is treated as `unknown`) so a partial
 * or unexpected result never throws — missing pieces become `null`/empty.
 */
export function extractThemePerformanceReport(
	lhr: unknown,
	context: { device: PerformanceDevice; themeId: string; url: string },
): ThemePerformanceReport {
	const root = isRecord(lhr) ? lhr : {};
	const categories = isRecord(root.categories) ? root.categories : {};
	const performance = isRecord(categories.performance)
		? categories.performance
		: {};
	const performanceScore =
		typeof performance.score === "number"
			? Math.round(performance.score * 100)
			: null;

	const audits = isRecord(root.audits) ? root.audits : {};
	const metrics: PerformanceMetric[] = [];
	for (const { id, label } of PERFORMANCE_METRIC_AUDITS) {
		const audit = audits[id];
		if (!isRecord(audit)) {
			continue;
		}
		metrics.push({
			id,
			label,
			displayValue:
				typeof audit.displayValue === "string" ? audit.displayValue : "",
			numericValue:
				typeof audit.numericValue === "number" ? audit.numericValue : null,
			score: typeof audit.score === "number" ? audit.score : null,
		});
	}

	return {
		device: context.device,
		themeId: context.themeId,
		url: context.url,
		finalUrl: extractFinalUrl(root),
		performanceScore,
		metrics,
		recommendations: extractRecommendations(performance, audits),
	};
}

function reportToJsonObject(report: ThemePerformanceReport, detailed: boolean) {
	return {
		device: report.device,
		final_url: report.finalUrl,
		performance_score: report.performanceScore,
		metrics: report.metrics.map((metric) => ({
			id: metric.id,
			title: metric.label,
			display_value: metric.displayValue,
			numeric_value: metric.numericValue,
			score: metric.score,
		})),
		// Only emit recommendations under `--detailed`, keeping the default payload lean.
		...(detailed
			? {
					recommendations: report.recommendations.map((rec) => ({
						id: rec.id,
						title: rec.title,
						description: rec.description,
						learn_more_url: rec.learnMoreUrl,
						display_value: rec.displayValue,
						score: rec.score,
						estimated_savings_ms: rec.estimatedSavingsMs,
						total_items: rec.totalItems,
						examples: rec.examples.map((example) => ({
							label: example.label,
							detail: example.detail,
						})),
					})),
				}
			: {}),
	};
}

/**
 * Machine-readable JSON for one or more device reports. `theme_id`/`url` are the
 * same storefront for every device, so they are hoisted to the top level; the
 * per-device reports are keyed by device under `results`. `detailed` adds the
 * per-device `recommendations` array.
 */
export function formatThemePerformanceReportsJson(
	reports: ThemePerformanceReport[],
	options: { detailed?: boolean } = {},
): string {
	const detailed = options.detailed ?? false;
	const first = reports[0];
	const results: Record<string, ReturnType<typeof reportToJsonObject>> = {};
	for (const report of reports) {
		results[report.device] = reportToJsonObject(report, detailed);
	}
	const payload = {
		theme_id: first?.themeId ?? null,
		url: first?.url ?? null,
		results,
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}

const chalk = new Chalk();

/** Buckets a 0..1 Lighthouse score into Lighthouse's own good/average/poor bands. */
function rateScore(score: number | null): {
	label: string;
	colorize: (text: string) => string;
} {
	if (score === null) {
		return { label: "n/a", colorize: (text) => chalk.dim(text) };
	}
	if (score >= 0.9) {
		return { label: "good", colorize: (text) => chalk.green(text) };
	}
	if (score >= 0.5) {
		return { label: "needs work", colorize: (text) => chalk.yellow(text) };
	}
	return { label: "poor", colorize: (text) => chalk.red(text) };
}

function colorizeOverallScore(score: number | null): string {
	if (score === null) {
		return chalk.dim("n/a");
	}
	const text = `${score} / 100`;
	if (score >= 90) {
		return chalk.green(text);
	}
	if (score >= 50) {
		return chalk.yellow(text);
	}
	return chalk.red(text);
}

function padEndVisible(text: string, width: number): string {
	return text.length >= width ? text : text.padEnd(width, " ");
}

/** Lighthouse's raw 0..1 metric score, rounded to two digits ("n/a" when absent). */
function formatScore(score: number | null): string {
	return score === null ? "n/a" : score.toFixed(2);
}

/** Renders the `--detailed` "Recommended changes" section for one device. */
function recommendationLines(
	recommendations: PerformanceRecommendation[],
): string[] {
	const lines: string[] = ["", chalk.bold("  Recommended changes")];
	if (recommendations.length === 0) {
		lines.push(
			chalk.dim("  All audited opportunities passed — nothing to improve."),
		);
		return lines;
	}
	for (const rec of recommendations) {
		// Red for a clear failure, yellow for "needs work"; matches the metric bands.
		const colorizeBullet =
			rec.score !== null && rec.score < 0.5
				? (text: string) => chalk.red(text)
				: (text: string) => chalk.yellow(text);
		const impact = rec.displayValue ? chalk.dim(` — ${rec.displayValue}`) : "";
		const link = rec.learnMoreUrl ? chalk.dim(` — ${rec.learnMoreUrl}`) : "";
		lines.push(`  ${colorizeBullet("●")} ${rec.title}${impact}${link}`);
		for (const example of rec.examples) {
			const detail = example.detail ? chalk.dim(` (${example.detail})`) : "";
			// A label may span several lines (a request-chain tree); the first line
			// follows the "- " marker, the rest align under it.
			const [first, ...rest] = example.label.split("\n");
			lines.push(`      - ${first}${detail}`);
			for (const continuation of rest) {
				lines.push(chalk.dim(`        ${continuation}`));
			}
		}
		const remaining = rec.totalItems - rec.examples.length;
		if (remaining > 0) {
			lines.push(chalk.dim(`      …and ${remaining} more`));
		}
	}
	return lines;
}

/**
 * Human-friendly, colorized report for a single device (default output). When
 * `detailed` is set, a "Recommended changes" section is appended.
 */
export function formatThemePerformanceReportHuman(
	report: ThemePerformanceReport,
	options: { detailed?: boolean } = {},
): string {
	const lines: string[] = [];
	lines.push(
		chalk.bold(`Theme performance report — ${deviceLabel(report.device)}`),
	);
	lines.push(`  Theme ID:  ${report.themeId}`);
	lines.push(`  URL:       ${report.finalUrl ?? report.url}`);
	lines.push("");
	lines.push(
		`  Performance score:  ${colorizeOverallScore(report.performanceScore)}`,
	);

	if (report.metrics.length > 0) {
		lines.push("");
		const labelWidth = Math.max(
			"Metric".length,
			...report.metrics.map((metric) => metric.label.length),
		);
		const valueWidth = Math.max(
			"Value".length,
			...report.metrics.map((metric) => metric.displayValue.length),
		);
		const scoreWidth = Math.max(
			"Score".length,
			...report.metrics.map((metric) => formatScore(metric.score).length),
		);
		lines.push(
			`  ${padEndVisible("Metric", labelWidth)}  ${padEndVisible("Value", valueWidth)}  ${padEndVisible("Score", scoreWidth)}  Rating`,
		);
		lines.push(
			`  ${"-".repeat(labelWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(scoreWidth)}  ------`,
		);
		for (const metric of report.metrics) {
			const rating = rateScore(metric.score);
			// Pad the plain score before colorizing so color codes don't skew alignment.
			const score = rating.colorize(
				padEndVisible(formatScore(metric.score), scoreWidth),
			);
			lines.push(
				`  ${padEndVisible(metric.label, labelWidth)}  ${padEndVisible(metric.displayValue || "-", valueWidth)}  ${score}  ${rating.colorize(rating.label)}`,
			);
		}
	}

	if (options.detailed) {
		lines.push(...recommendationLines(report.recommendations));
	}

	return `${lines.join("\n")}\n`;
}

/** Human-friendly report covering every device, each section separated by a blank line. */
export function formatThemePerformanceReportsHuman(
	reports: ThemePerformanceReport[],
	options: { detailed?: boolean } = {},
): string {
	return reports
		.map((report) => formatThemePerformanceReportHuman(report, options))
		.join("\n");
}
