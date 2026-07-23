import { describe, expect, it } from "vitest";
import {
	type ThemePerformanceReport,
	extractThemePerformanceReport,
	formatThemePerformanceReportHuman,
	formatThemePerformanceReportsHuman,
	formatThemePerformanceReportsJson,
} from "./theme-api-performance-report";

const FIXTURE_LHR = {
	finalDisplayedUrl: "https://store.example.com/?theme_installation_id=42",
	requestedUrl: "https://store.example.com/?theme_installation_id=42",
	categories: { performance: { score: 0.92 } },
	audits: {
		"first-contentful-paint": {
			displayValue: "1.2 s",
			numericValue: 1200,
			score: 0.95,
		},
		"speed-index": { displayValue: "2.3 s", numericValue: 2300, score: 0.6 },
		"largest-contentful-paint": {
			displayValue: "2.1 s",
			numericValue: 2100,
			score: 0.3,
		},
		"total-blocking-time": {
			displayValue: "150 ms",
			numericValue: 150,
			score: null,
		},
		"cumulative-layout-shift": {
			displayValue: "0.02",
			numericValue: 0.02,
			score: 1,
		},
	},
};

describe("extractThemePerformanceReport", () => {
	it("maps the performance score to a 0..100 integer and keeps the device", () => {
		const report = extractThemePerformanceReport(FIXTURE_LHR, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/?theme_installation_id=42",
		});
		expect(report.performanceScore).toBe(92);
		expect(report.device).toBe("mobile");
	});

	it("extracts known metrics in display order and skips missing ones", () => {
		const report = extractThemePerformanceReport(FIXTURE_LHR, {
			device: "desktop",
			themeId: "42",
			url: "https://store.example.com/",
		});
		// `interactive` is absent from the fixture, so it must not appear.
		expect(report.metrics.map((m) => m.id)).toEqual([
			"first-contentful-paint",
			"speed-index",
			"largest-contentful-paint",
			"total-blocking-time",
			"cumulative-layout-shift",
		]);
		const fcp = report.metrics[0];
		expect(fcp?.label).toBe("First Contentful Paint");
		expect(fcp?.displayValue).toBe("1.2 s");
		expect(fcp?.numericValue).toBe(1200);
		expect(fcp?.score).toBe(0.95);
	});

	it("prefers finalDisplayedUrl, falling back to legacy fields", () => {
		expect(
			extractThemePerformanceReport(FIXTURE_LHR, {
				device: "mobile",
				themeId: "42",
				url: "https://requested.example.com/",
			}).finalUrl,
		).toBe("https://store.example.com/?theme_installation_id=42");

		const legacy = extractThemePerformanceReport(
			{ finalUrl: "https://legacy.example.com/", audits: {}, categories: {} },
			{ device: "mobile", themeId: "1", url: "https://x/" },
		);
		expect(legacy.finalUrl).toBe("https://legacy.example.com/");
	});

	it("returns null score and empty metrics for an unexpected result", () => {
		const report = extractThemePerformanceReport(null, {
			device: "desktop",
			themeId: "7",
			url: "https://store.example.com/",
		});
		expect(report.performanceScore).toBeNull();
		expect(report.metrics).toEqual([]);
		expect(report.finalUrl).toBeNull();
		expect(report.themeId).toBe("7");
	});
});

function reportFor(
	device: "mobile" | "desktop",
	score: number,
): ThemePerformanceReport {
	return extractThemePerformanceReport(
		{ ...FIXTURE_LHR, categories: { performance: { score } } },
		{
			device,
			themeId: "42",
			url: "https://store.example.com/?theme_installation_id=42",
		},
	);
}

describe("formatThemePerformanceReportsJson", () => {
	it("hoists theme_id/url and keys each report by device", () => {
		const json = formatThemePerformanceReportsJson([
			reportFor("mobile", 0.92),
			reportFor("desktop", 0.99),
		]);
		const parsed = JSON.parse(json);
		expect(parsed.theme_id).toBe("42");
		expect(parsed.url).toBe(
			"https://store.example.com/?theme_installation_id=42",
		);
		expect(parsed.results.mobile.device).toBe("mobile");
		expect(parsed.results.mobile.performance_score).toBe(92);
		expect(parsed.results.desktop.performance_score).toBe(99);
		expect(parsed.results.mobile.metrics[0]).toEqual({
			id: "first-contentful-paint",
			title: "First Contentful Paint",
			display_value: "1.2 s",
			numeric_value: 1200,
			score: 0.95,
		});
	});

	it("ends with a trailing newline", () => {
		const json = formatThemePerformanceReportsJson([reportFor("mobile", 0.92)]);
		expect(json.endsWith("\n")).toBe(true);
	});
});

describe("formatThemePerformanceReportHuman", () => {
	it("labels the report with its device and renders per-metric ratings", () => {
		const report = extractThemePerformanceReport(FIXTURE_LHR, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/?theme_installation_id=42",
		});
		const text = formatThemePerformanceReportHuman(report);
		expect(text).toContain("Theme performance report — Mobile");
		expect(text).toContain("92 / 100");
		expect(text).toContain("First Contentful Paint");
		expect(text).toContain("Score");
		expect(text).toContain("0.95"); // raw score for FCP, two digits
		expect(text).toContain("0.60"); // raw score for Speed Index (0.6 → 0.60)
		expect(text).toContain("0.30"); // raw score for LCP
		expect(text).toContain("1.00"); // raw score for CLS (1 → 1.00)
		expect(text).toContain("good"); // score 0.95 → good
		expect(text).toContain("needs work"); // score 0.6 → needs work
		expect(text).toContain("poor"); // score 0.3 → poor
		expect(text).toContain("n/a"); // score null → n/a
	});

	it("shows n/a when there is no performance score", () => {
		const report: ThemePerformanceReport = {
			device: "desktop",
			themeId: "1",
			url: "https://store.example.com/",
			finalUrl: null,
			performanceScore: null,
			metrics: [],
			recommendations: [],
		};
		const text = formatThemePerformanceReportHuman(report);
		expect(text).toContain("Theme performance report — Desktop");
		expect(text).toContain("Performance score:");
		expect(text).toContain("n/a");
	});
});

const FIXTURE_WITH_RECS = {
	finalDisplayedUrl: "https://store.example.com/",
	categories: {
		performance: {
			score: 0.5,
			auditRefs: [
				{ id: "first-contentful-paint", group: "metrics" }, // a metric, not a recommendation
				{ id: "unused-javascript", group: "diagnostics" },
				{ id: "render-blocking-insight", group: "insights" },
				{ id: "unminified-css", group: "diagnostics" }, // passing (score 1) → excluded
				{ id: "non-composited-animations", group: "diagnostics" }, // notApplicable → excluded
				{ id: "screenshot-thumbnails", group: "hidden" }, // hidden group → excluded
			],
		},
	},
	audits: {
		"first-contentful-paint": {
			title: "First Contentful Paint",
			score: 0.3,
			displayValue: "2.1 s",
		},
		"unused-javascript": {
			title: "Reduce unused JavaScript",
			description: "Reduce unused JS. [Learn more](https://web.dev/unused-js).",
			score: 0,
			displayValue: "Est savings of 1,399 KiB",
			details: {
				type: "opportunity",
				overallSavingsMs: 1500,
				// Intentionally NOT pre-sorted, to prove examples are ranked by impact.
				items: [
					{ url: "https://cdn.example.com/c.js", wastedBytes: 20480 },
					{ url: "https://cdn.example.com/a.js", wastedBytes: 104448 },
					{ url: "https://cdn.example.com/e.js", wastedBytes: 5120 },
					{ url: "https://cdn.example.com/b.js", wastedBytes: 51200 },
					{ url: "https://cdn.example.com/d.js", wastedBytes: 10240 },
				],
			},
		},
		"render-blocking-insight": {
			title: "Render blocking requests",
			description:
				"Requests are [blocking](https://web.dev/render-blocking) the page's first paint.",
			score: 0.4,
			// Title is in ms, so every example must use ms — even the row that only
			// carries a byte field must NOT leak a "KiB" value.
			displayValue: "Est savings of 240 ms",
			metricSavings: { FCP: 250, LCP: 0 },
			details: {
				type: "table",
				items: [
					{ url: "https://a/late.css", totalBytes: 51200 }, // bytes-only row
					{
						node: {
							type: "node",
							selector: "div.hero > img.banner",
							nodeLabel: "Hero banner",
							snippet: '<img class="banner">',
						},
						wastedMs: 120,
					},
					{ url: "https://a/blocking.css", totalBytes: 34856, wastedMs: 300 },
				],
			},
		},
		"unminified-css": { title: "Minify CSS", score: 1, displayValue: "" },
		"non-composited-animations": {
			title: "Avoid non-composited animations",
			score: null,
			scoreDisplayMode: "notApplicable",
		},
		"screenshot-thumbnails": { title: "hidden", score: null },
	},
};

describe("extractThemePerformanceReport (recommendations)", () => {
	it("keeps only failing opportunity/diagnostic audits, worst impact first", () => {
		const report = extractThemePerformanceReport(FIXTURE_WITH_RECS, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/",
		});
		// unused-javascript (1500 ms) sorts ahead of render-blocking (250 ms);
		// the metric, passing, not-applicable, and hidden audits are excluded.
		expect(report.recommendations.map((r) => r.id)).toEqual([
			"unused-javascript",
			"render-blocking-insight",
		]);
		const [first, second] = report.recommendations;
		expect(first?.title).toBe("Reduce unused JavaScript");
		expect(first?.estimatedSavingsMs).toBe(1500);
		// Markdown link flattened to "text (url)".
		expect(first?.description).toBe(
			"Reduce unused JS. Learn more (https://web.dev/unused-js).",
		);
		// The doc link is extracted from the description's markdown link.
		expect(first?.learnMoreUrl).toBe("https://web.dev/unused-js");
		// render-blocking's only link is mid-sentence; it is still captured.
		expect(second?.learnMoreUrl).toBe("https://web.dev/render-blocking");
		// metricSavings max used when overallSavingsMs is absent.
		expect(second?.estimatedSavingsMs).toBe(250);
	});

	it("captures URL and element examples with per-item impact", () => {
		const report = extractThemePerformanceReport(FIXTURE_WITH_RECS, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/",
		});
		const [unusedJs, renderBlocking] = report.recommendations;

		// The 3 highest-impact rows (102/50/20 KiB), even though the source rows
		// are unsorted; the 10 KiB and 5 KiB rows are dropped. wastedBytes → KiB.
		expect(unusedJs?.totalItems).toBe(5);
		expect(unusedJs?.examples).toEqual([
			{ label: "https://cdn.example.com/a.js", detail: "102 KiB" },
			{ label: "https://cdn.example.com/b.js", detail: "50 KiB" },
			{ label: "https://cdn.example.com/c.js", detail: "20 KiB" },
		]);

		// The title is in ms, so ALL rows are ranked/shown in ms — the bytes-only
		// row renders with no unit rather than a stray "KiB", and the element row
		// falls back to its node selector.
		expect(renderBlocking?.examples).toEqual([
			{ label: "https://a/blocking.css", detail: "300 ms" },
			{ label: "div.hero > img.banner", detail: "120 ms" },
			{ label: "https://a/late.css", detail: "" },
		]);
	});

	it("omits the unit when a row's impact is negligible", () => {
		const report = extractThemePerformanceReport(
			{
				categories: {
					performance: {
						score: 0.4,
						auditRefs: [{ id: "tiny", group: "diagnostics" }],
					},
				},
				audits: {
					tiny: {
						title: "Tiny",
						score: 0,
						details: {
							type: "table",
							items: [{ url: "https://a/tiny.css", totalBytes: 300 }],
						},
					},
				},
			},
			{ device: "mobile", themeId: "1", url: "https://x/" },
		);
		// 300 bytes rounds to 0 KiB → label shown, but no misleading "0 KiB".
		expect(report.recommendations[0]?.examples[0]).toEqual({
			label: "https://a/tiny.css",
			detail: "",
		});
	});

	it("renders each network-dependency chain as a tree of chained URLs", () => {
		const report = extractThemePerformanceReport(
			{
				categories: {
					performance: {
						score: 0.5,
						auditRefs: [
							{ id: "network-dependency-tree-insight", group: "insights" },
						],
					},
				},
				audits: {
					"network-dependency-tree-insight": {
						title: "Network dependency tree",
						description:
							"Avoid chaining critical requests. [Learn more](https://web.dev/network-tree).",
						score: 0.4,
						details: {
							type: "list",
							items: [
								{
									type: "list-section",
									value: {
										type: "network-tree",
										chains: {
											ROOT: {
												url: "https://a/root.html",
												navStartToEndTime: 200,
												children: {
													C1: {
														url: "https://a/app.js",
														children: {
															G1: {
																url: "https://a/vendor.js",
																children: {},
															},
														},
													},
													C2: { url: "https://a/styles.css", children: {} },
												},
											},
										},
									},
								},
							],
						},
					},
				},
			},
			{ device: "mobile", themeId: "1", url: "https://x/" },
		);
		const rec = report.recommendations[0];
		expect(rec?.learnMoreUrl).toBe("https://web.dev/network-tree");
		expect(rec?.totalItems).toBe(1);
		// One example per root chain: a tree of the chained URLs, with the chain's
		// end time as the detail.
		expect(rec?.examples).toEqual([
			{
				label: [
					"https://a/root.html",
					"├─ https://a/app.js",
					"│  └─ https://a/vendor.js",
					"└─ https://a/styles.css",
				].join("\n"),
				detail: "200 ms",
			},
		]);
	});

	it("indents a multi-line chain tree under its example marker", () => {
		const report: ThemePerformanceReport = {
			device: "mobile",
			themeId: "1",
			url: "https://x/",
			finalUrl: null,
			performanceScore: 50,
			metrics: [],
			recommendations: [
				{
					id: "network-dependency-tree-insight",
					title: "Network dependency tree",
					description: "",
					learnMoreUrl: null,
					displayValue: "",
					score: 0.4,
					estimatedSavingsMs: null,
					examples: [{ label: "root.html\n└─ app.js", detail: "" }],
					totalItems: 1,
				},
			],
		};
		const text = formatThemePerformanceReportHuman(report, { detailed: true });
		expect(text).toContain("      - root.html");
		expect(text).toContain("        └─ app.js");
	});

	it("surfaces only the failing checks of a checklist insight", () => {
		const report = extractThemePerformanceReport(
			{
				categories: {
					performance: {
						score: 0.5,
						auditRefs: [{ id: "document-latency-insight", group: "insights" }],
					},
				},
				audits: {
					"document-latency-insight": {
						title: "Document request latency",
						description:
							"The first request matters. [Learn more](https://web.dev/doc).",
						score: 0.5,
						details: {
							type: "checklist",
							items: {
								noRedirects: { label: "Avoids redirects", value: true },
								serverResponseIsFast: {
									label: "Server responds slowly (observed 1200 ms)",
									value: false,
								},
								usesCompression: {
									label: "No text compression applied",
									value: false,
								},
							},
						},
					},
				},
			},
			{ device: "mobile", themeId: "1", url: "https://x/" },
		);
		const rec = report.recommendations[0];
		// Passing check is dropped; the two failing checks become examples.
		expect(rec?.examples).toEqual([
			{ label: "Server responds slowly (observed 1200 ms)", detail: "" },
			{ label: "No text compression applied", detail: "" },
		]);
		expect(rec?.totalItems).toBe(2);
	});
});

describe("formatThemePerformanceReportsJson (detailed)", () => {
	it("omits recommendations by default and includes them when detailed", () => {
		const report = extractThemePerformanceReport(FIXTURE_WITH_RECS, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/",
		});
		const plain = JSON.parse(formatThemePerformanceReportsJson([report]));
		expect(plain.results.mobile.recommendations).toBeUndefined();

		const detailed = JSON.parse(
			formatThemePerformanceReportsJson([report], { detailed: true }),
		);
		expect(detailed.results.mobile.recommendations[0]).toEqual({
			id: "unused-javascript",
			title: "Reduce unused JavaScript",
			description: "Reduce unused JS. Learn more (https://web.dev/unused-js).",
			learn_more_url: "https://web.dev/unused-js",
			display_value: "Est savings of 1,399 KiB",
			score: 0,
			estimated_savings_ms: 1500,
			total_items: 5,
			examples: [
				{ label: "https://cdn.example.com/a.js", detail: "102 KiB" },
				{ label: "https://cdn.example.com/b.js", detail: "50 KiB" },
				{ label: "https://cdn.example.com/c.js", detail: "20 KiB" },
			],
		});
	});
});

describe("formatThemePerformanceReportHuman (detailed)", () => {
	it("appends a Recommended changes section only when detailed", () => {
		const report = extractThemePerformanceReport(FIXTURE_WITH_RECS, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/",
		});
		expect(formatThemePerformanceReportHuman(report)).not.toContain(
			"Recommended changes",
		);
		const detailed = formatThemePerformanceReportHuman(report, {
			detailed: true,
		});
		expect(detailed).toContain("Recommended changes");
		expect(detailed).toContain("Reduce unused JavaScript");
		expect(detailed).toContain("Est savings of 1,399 KiB");
		// The doc link is on the title line; the description prose is NOT rendered.
		expect(detailed).toContain("https://web.dev/unused-js");
		expect(detailed).not.toContain("Reduce unused JS.");
		// Concrete example items and the "and N more" summary of the rest.
		expect(detailed).toContain("https://cdn.example.com/a.js");
		expect(detailed).toContain("102 KiB");
		expect(detailed).toContain("…and 2 more");
	});

	it("shows a friendly message when there are no recommendations", () => {
		const report = extractThemePerformanceReport(FIXTURE_LHR, {
			device: "mobile",
			themeId: "42",
			url: "https://store.example.com/",
		});
		const detailed = formatThemePerformanceReportHuman(report, {
			detailed: true,
		});
		expect(detailed).toContain("Recommended changes");
		expect(detailed).toContain("nothing to improve");
	});
});

describe("formatThemePerformanceReportsHuman", () => {
	it("renders a labelled section for each device", () => {
		const text = formatThemePerformanceReportsHuman([
			reportFor("mobile", 0.92),
			reportFor("desktop", 0.99),
		]);
		expect(text).toContain("Theme performance report — Mobile");
		expect(text).toContain("Theme performance report — Desktop");
	});
});
