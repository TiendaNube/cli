import { describe, expect, it } from "vitest";
import {
	type ThemeDiffReport,
	formatThemeDiffHuman,
	formatThemeDiffJson,
	makeThemeDiffEntry,
	themeDiffChangeCount,
	themeDiffInSync,
} from "./theme-api-diff-report";

function emptyReport(
	overrides: Partial<ThemeDiffReport> = {},
): ThemeDiffReport {
	return {
		themeId: "9",
		forked: true,
		added: [],
		modified: [],
		deleted: [],
		unchangedCount: 0,
		skippedNotForked: [],
		pushUnsupportedCount: 0,
		readFailCount: 0,
		...overrides,
	};
}

function populatedReport(): ThemeDiffReport {
	return emptyReport({
		unchangedCount: 128,
		added: [
			makeThemeDiffEntry({
				path: "sections/hero.tpl",
				format: "text",
				lines: 48,
				sizeBytes: 1810,
				linesAdded: 48,
				patch:
					"--- /dev/null\n+++ local/sections/hero.tpl\n@@ -0,0 +1,1 @@\n+hero",
			}),
		],
		modified: [
			makeThemeDiffEntry({
				path: "layouts/default.tpl",
				format: "text",
				linesAdded: 12,
				linesRemoved: 3,
				remoteSizeBytes: 100,
				localSizeBytes: 140,
				patch:
					"--- remote/layouts/default.tpl\n+++ local/layouts/default.tpl\n@@ -1,1 +1,1 @@\n-old\n+new",
			}),
		],
		deleted: [
			makeThemeDiffEntry({
				path: "snippets/legacy.tpl",
				format: "text",
				lines: 30,
				sizeBytes: 400,
				linesRemoved: 30,
				patch:
					"--- remote/snippets/legacy.tpl\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone",
			}),
		],
	});
}

describe("themeDiffChangeCount", () => {
	it("sums the three change buckets", () => {
		expect(themeDiffChangeCount(emptyReport())).toBe(0);
		expect(themeDiffChangeCount(populatedReport())).toBe(3);
	});
});

describe("themeDiffInSync", () => {
	it("requires no changes, nothing skipped and nothing unread", () => {
		expect(themeDiffInSync(emptyReport({ unchangedCount: 12 }))).toBe(true);
		expect(themeDiffInSync(populatedReport())).toBe(false);
	});

	it("is false when a non-forked theme has unpushable local changes", () => {
		const report = emptyReport({
			forked: false,
			skippedNotForked: ["sections/header.tpl"],
		});
		expect(themeDiffChangeCount(report)).toBe(0);
		expect(themeDiffInSync(report)).toBe(false);
	});

	it("is false when a file could not be read", () => {
		expect(themeDiffInSync(emptyReport({ readFailCount: 1 }))).toBe(false);
	});

	it("ignores custom/ files, which are never compared", () => {
		expect(themeDiffInSync(emptyReport({ pushUnsupportedCount: 2 }))).toBe(
			true,
		);
	});
});

describe("formatThemeDiffJson", () => {
	it("marks an in-sync theme and ends with a newline", () => {
		const output = formatThemeDiffJson(emptyReport({ unchangedCount: 12 }));
		expect(output.endsWith("\n")).toBe(true);
		const parsed = JSON.parse(output);
		expect(parsed).toMatchObject({
			theme_id: "9",
			forked: true,
			detailed: false,
			in_sync: true,
			summary: {
				added: 0,
				modified: 0,
				deleted: 0,
				unchanged: 12,
				skipped_not_forked: 0,
				skipped_push_unsupported: 0,
				read_failures: 0,
			},
		});
	});

	it("omits patches and line counts without --detailed", () => {
		const parsed = JSON.parse(formatThemeDiffJson(populatedReport()));
		expect(parsed.modified[0]).toEqual({
			path: "layouts/default.tpl",
			format: "text",
		});
		expect(parsed.added[0]).toEqual({
			path: "sections/hero.tpl",
			format: "text",
			lines: 48,
			size_bytes: 1810,
		});
		expect(parsed.deleted[0]).not.toHaveProperty("patch");
	});

	it("includes patches and line counts with --detailed", () => {
		const parsed = JSON.parse(
			formatThemeDiffJson(populatedReport(), { detailed: true }),
		);
		expect(parsed.detailed).toBe(true);
		expect(parsed.modified[0]).toMatchObject({
			lines_added: 12,
			lines_removed: 3,
			remote_size_bytes: 100,
			local_size_bytes: 140,
			truncated: false,
			note: null,
		});
		expect(parsed.modified[0].patch).toContain("@@ -1,1 +1,1 @@");
		expect(parsed.added[0].patch).toContain("+hero");
		expect(parsed.deleted[0].patch).toContain("-gone");
	});

	it("flags binary files and spells out notes", () => {
		const report = emptyReport({
			modified: [
				makeThemeDiffEntry({
					path: "static/logo.png",
					format: "base64",
					remoteSizeBytes: 12_700,
					localSizeBytes: 13_400,
				}),
				makeThemeDiffEntry({
					path: "sections/a.tpl",
					format: "text",
					note: "content_unavailable",
					noteDetail: "HTTP 500",
				}),
				makeThemeDiffEntry({
					path: "sections/b.tpl",
					format: "text",
					note: "line_endings_differ",
				}),
			],
		});
		const parsed = JSON.parse(formatThemeDiffJson(report, { detailed: true }));
		expect(parsed.modified[0]).toMatchObject({ binary: true, patch: null });
		expect(parsed.modified[1].note).toBe("content_unavailable: HTTP 500");
		expect(parsed.modified[2].note).toBe("line_endings_differ");
	});

	it("lists files push would skip on a non-forked theme", () => {
		const parsed = JSON.parse(
			formatThemeDiffJson(
				emptyReport({
					forked: false,
					skippedNotForked: ["sections/header.tpl"],
					pushUnsupportedCount: 2,
					readFailCount: 1,
				}),
			),
		);
		expect(parsed.forked).toBe(false);
		expect(parsed.skipped_not_forked).toEqual(["sections/header.tpl"]);
		expect(parsed.summary.skipped_push_unsupported).toBe(2);
		expect(parsed.summary.read_failures).toBe(1);
		// Skipped changes and unread files are not "in sync": automation gating a
		// deploy on this flag must not see a dirty theme as clean.
		expect(parsed.in_sync).toBe(false);
	});
});

describe("formatThemeDiffHuman", () => {
	it("reports an in-sync theme", () => {
		const output = formatThemeDiffHuman(emptyReport({ unchangedCount: 5 }));
		expect(output).toContain("0 changes");
		expect(output).toContain("No differences — the theme is in sync.");
		expect(output).toContain("Unchanged: 5");
	});

	it("groups the three change kinds without patches by default", () => {
		const output = formatThemeDiffHuman(populatedReport());
		expect(output).toContain("Theme diff for theme 9 (forked) — 3 changes");
		expect(output).toContain("Added (1)");
		expect(output).toContain("sections/hero.tpl");
		expect(output).toContain("48 lines");
		expect(output).toContain("Modified (1)");
		expect(output).toContain("+12");
		expect(output).toContain("-3");
		expect(output).toContain("Deleted (1)");
		expect(output).toContain("30 lines");
		expect(output).not.toContain("@@");
	});

	it("appends the unified diff with --detailed", () => {
		const output = formatThemeDiffHuman(populatedReport(), { detailed: true });
		expect(output).toContain("@@ -1,1 +1,1 @@");
		expect(output).toContain("-old");
		expect(output).toContain("+new");
	});

	it("shows binary sizes, notes and truncation", () => {
		const report = emptyReport({
			modified: [
				makeThemeDiffEntry({
					path: "static/logo.png",
					format: "base64",
					remoteSizeBytes: 12_700,
					localSizeBytes: 13_400,
				}),
				makeThemeDiffEntry({
					path: "sections/a.tpl",
					format: "text",
					note: "content_unavailable",
					noteDetail: "HTTP 500",
				}),
				makeThemeDiffEntry({
					path: "sections/b.tpl",
					format: "text",
					linesAdded: 900,
					linesRemoved: 900,
					truncated: true,
					patch: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-x\n+y",
				}),
			],
		});
		const output = formatThemeDiffHuman(report, { detailed: true });
		expect(output).toContain("binary, 12.4 KB → 13.1 KB");
		expect(output).toContain("remote content unavailable: HTTP 500");
		expect(output).toContain("diff truncated");
	});

	it("lists skipped and unreadable files", () => {
		const output = formatThemeDiffHuman(
			emptyReport({
				forked: false,
				skippedNotForked: ["sections/header.tpl"],
				pushUnsupportedCount: 2,
				readFailCount: 1,
			}),
		);
		expect(output).toContain("(not forked)");
		expect(output).toContain("Skipped (not forked, but has changes): 1");
		expect(output).toContain("sections/header.tpl");
		expect(output).toContain("Skipped (custom/, push not supported yet): 2");
		expect(output).toContain("Files that could not be read: 1");
		// It used to claim the theme was in sync three lines above the skip count.
		expect(output).not.toContain("No differences");
	});
});
