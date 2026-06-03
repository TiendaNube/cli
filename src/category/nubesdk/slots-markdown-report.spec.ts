import { describe, expect, it } from "vitest";
import { UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX } from "./slot-catalog";
import {
	BuildMarkdownSummarySection,
	BuildSlotsMarkdownReport,
	FormatSlotReportSummaryLines,
	NormalizeMarkdownFileName,
} from "./slots-markdown-report";

const sampleIso = "2026-04-02T12:00:00.000Z";

describe("slots-markdown-report", () => {
	it("marks present and missing slots", () => {
		const md = BuildSlotsMarkdownReport(["alpha", "beta"], new Set(["alpha"]), {
			title: "# Test",
		});
		expect(md).toContain("- [x] alpha");
		expect(md).toContain("- [ ] beta");
		expect(md.startsWith("# Test\n\n")).toBe(true);
	});

	it("notes deprecated DOM alias when satisfied only via legacy data attribute", () => {
		const direct = new Set<string>();
		const legacy = new Map([["canonical_slot", "legacy_slot"]]);
		const found = new Set(["canonical_slot"]);
		const md = BuildSlotsMarkdownReport(["canonical_slot"], found, {
			title: "# Test",
			directCanonical: direct,
			legacyDomByCanonical: legacy,
		});
		expect(md).toContain(
			"- [x] canonical_slot (deprecated DOM alias: `legacy_slot`)",
		);
	});

	it("notes indirect coverage via product-item-image when not direct in theme", () => {
		const direct = new Set<string>();
		const indirect = new Set(["grid_slot_a"]);
		const found = new Set(["grid_slot_a"]);
		const md = BuildSlotsMarkdownReport(["grid_slot_a"], found, {
			title: "# Test",
			directCanonical: direct,
			indirectViaProductItemImage: indirect,
		});
		expect(md).toContain(
			"- [x] grid_slot_a (via platform component product-item-image)",
		);
	});

	it("appends unresolved references section when found contains sentinel entries", () => {
		const md = BuildSlotsMarkdownReport(
			["alpha"],
			new Set(["alpha", `${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}typo_slot`]),
			{ title: "# Test" },
		);
		expect(md).toContain("## Unresolved slot references in theme");
		expect(md).toContain("- typo_slot");
	});

	it("NormalizeMarkdownFileName adds .md when missing", () => {
		expect(NormalizeMarkdownFileName("slots-report")).toBe("slots-report.md");
	});

	it("NormalizeMarkdownFileName keeps .md case-insensitive", () => {
		expect(NormalizeMarkdownFileName("out.MD")).toBe("out.MD");
	});

	it("NormalizeMarkdownFileName replaces non-md extension with .md", () => {
		expect(NormalizeMarkdownFileName("report.txt")).toBe("report.md");
	});

	it("NormalizeMarkdownFileName uses basename only (ignores path segments)", () => {
		expect(NormalizeMarkdownFileName("nested/slots-report")).toBe(
			"slots-report.md",
		);
	});

	it("NormalizeMarkdownFileName returns empty for invalid names", () => {
		expect(NormalizeMarkdownFileName("")).toBe("");
		expect(NormalizeMarkdownFileName("  ")).toBe("");
		expect(NormalizeMarkdownFileName("..")).toBe("");
	});

	it("appends summary section when provided", () => {
		const md = BuildSlotsMarkdownReport(["a"], new Set(["a"]), {
			title: "# T",
			summary: {
				tplFilesAnalyzed: 3,
				durationMs: 1500,
				reportTimestampIso: sampleIso,
			},
		});
		expect(md).toContain("## Summary");
		expect(md).toContain(`Generated at: ${sampleIso}`);
		expect(md).toContain(".tpl files analyzed: 3");
		expect(md).toContain("Execution time: 1.50 s");
	});

	it("FormatSlotReportSummaryLines pluralizes file / files", () => {
		const one = FormatSlotReportSummaryLines({
			tplFilesAnalyzed: 1,
			durationMs: 1000,
			reportTimestampIso: sampleIso,
		});
		expect(one[0]).toBe(`Generated at: ${sampleIso}`);
		expect(one[1]).toContain("1 .tpl file analyzed");
		const many = FormatSlotReportSummaryLines({
			tplFilesAnalyzed: 2,
			durationMs: 1000,
			reportTimestampIso: sampleIso,
		});
		expect(many[1]).toContain("2 .tpl files analyzed");
	});

	it("BuildMarkdownSummarySection", () => {
		const s = BuildMarkdownSummarySection({
			tplFilesAnalyzed: 0,
			durationMs: 333.3,
			reportTimestampIso: sampleIso,
		});
		expect(s).toContain(`Generated at: ${sampleIso}`);
		expect(s).toContain("0");
		expect(s).toContain("0.33 s");
	});
});
