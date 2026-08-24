import { describe, expect, it } from "vitest";
import {
	extractInstallationsArray,
	extractThemeIdFromResponse,
	formatInstallationsAsTextTable,
	parseGetFileResponse,
	parseGetFilesResponse,
	parseInstallationsList,
	parseUpdateTargets,
	parseUpdateTestReport,
	stringifyListInstallationsResponse,
} from "./theme-api-response-parsers";

describe("parseUpdateTargets", () => {
	it("parses the forked shape, preserving the API's order", () => {
		expect(
			parseUpdateTargets({
				forked: true,
				current_version: "1.0.0",
				targets: ["2.1.1", "2.1.0", "1.1.0"],
			}),
		).toEqual({
			forked: true,
			currentVersion: "1.0.0",
			// Not re-sorted: sorting version strings here is how 10.0.0 lands under 9.0.0.
			targets: ["2.1.1", "2.1.0", "1.1.0"],
		});
	});

	it("parses the non-forked major shape", () => {
		expect(
			parseUpdateTargets({
				forked: false,
				current_version: "1",
				targets: ["3", "2"],
			}),
		).toEqual({ forked: false, currentVersion: "1", targets: ["3", "2"] });
	});

	it("treats an empty list as up to date, not as an error", () => {
		expect(
			parseUpdateTargets({
				forked: true,
				current_version: "2.0.0",
				targets: [],
			}).targets,
		).toEqual([]);
	});

	it("tolerates a missing current_version and a missing list", () => {
		expect(parseUpdateTargets({ forked: true })).toEqual({
			forked: true,
			currentVersion: null,
			targets: [],
		});
	});

	it("drops non-string entries rather than passing them on as targets", () => {
		expect(
			parseUpdateTargets({ targets: ["2.0.0", 3, null, "1.1.0"] }).targets,
		).toEqual(["2.0.0", "1.1.0"]);
	});

	it("throws when the body is not an object", () => {
		expect(() => parseUpdateTargets("nope")).toThrow(
			"Invalid API response: expected JSON object",
		);
	});
});

describe("parseUpdateTestReport", () => {
	it("parses versions and conflicting files", () => {
		expect(
			parseUpdateTestReport({
				baseline_version: "1.0.0",
				target_version: "2.0.0",
				conflicts: 2,
				conflicting_files: ["sections/hero.tpl", "snippets/nav.tpl"],
			}),
		).toEqual({
			baselineVersion: "1.0.0",
			targetVersion: "2.0.0",
			conflictingFiles: ["sections/hero.tpl", "snippets/nav.tpl"],
		});
	});

	it("treats a missing conflicting_files as no conflicts", () => {
		expect(
			parseUpdateTestReport({
				baseline_version: "1.0.0",
				target_version: "2.0.0",
				conflicts: 0,
			}).conflictingFiles,
		).toEqual([]);
	});

	it("refuses a conflicts count that disagrees with the file list", () => {
		// Under-reporting here would put "No local edits will be lost" on the prompt
		// that authorizes overwriting them.
		expect(() =>
			parseUpdateTestReport({
				conflicts: 7,
				conflicting_files: ["sections/hero.tpl"],
			}),
		).toThrow("`conflicts` is 7 but 1 usable file path(s) were returned");
	});

	it("refuses a count with no list at all", () => {
		expect(() => parseUpdateTestReport({ conflicts: 3 })).toThrow(
			"`conflicts` is 3 but 0 usable file path(s) were returned",
		);
	});

	it("refuses a list whose entries are not all usable paths", () => {
		// Dropping the unusable ones would report fewer files than the API counted,
		// which is the same silent under-report by another route.
		expect(() =>
			parseUpdateTestReport({
				conflicts: 4,
				conflicting_files: ["a.tpl", 5, null, "b.tpl"],
			}),
		).toThrow("`conflicts` is 4 but 2 usable file path(s) were returned");
	});

	it("nulls out absent versions when the counts agree", () => {
		expect(
			parseUpdateTestReport({
				conflicts: 2,
				conflicting_files: ["a.tpl", "b.tpl"],
			}),
		).toEqual({
			baselineVersion: null,
			targetVersion: null,
			conflictingFiles: ["a.tpl", "b.tpl"],
		});
	});

	it("refuses a missing or non-integer conflicts count", () => {
		for (const conflicts of [undefined, null, "2", 1.5, Number.NaN]) {
			expect(() =>
				parseUpdateTestReport({ conflicts, conflicting_files: [] }),
			).toThrow("`conflicts` must be an integer count");
		}
	});

	it("refuses a negative conflicts count", () => {
		expect(() =>
			parseUpdateTestReport({ conflicts: -1, conflicting_files: [] }),
		).toThrow("`conflicts` cannot be negative (got -1)");
	});

	it("throws when the body is not an object", () => {
		expect(() => parseUpdateTestReport("nope")).toThrow(
			"Invalid API response: expected JSON object",
		);
	});
});

describe("parseGetFilesResponse", () => {
	it("parses installation and files", () => {
		const { installation, files } = parseGetFilesResponse({
			installation: { id: 1, theme_version: "1" },
			files: [
				{ path: "a.tpl", format: "text", content: "x" },
				{ path: "b.json", format: "json", content: { k: 1 } },
			],
		});
		expect(files).toHaveLength(2);
		expect(files[0]?.path).toBe("a.tpl");
		expect(installation).toMatchObject({ id: 1 });
	});

	it("extracts `total` when the server returns it", () => {
		const { total } = parseGetFilesResponse({
			installation: { id: 1 },
			files: [],
			total: 231,
		});
		expect(total).toBe(231);
	});

	it("returns total=null when the field is absent or non-numeric", () => {
		expect(
			parseGetFilesResponse({ installation: {}, files: [] }).total,
		).toBeNull();
		expect(
			parseGetFilesResponse({ installation: {}, files: [], total: "231" })
				.total,
		).toBeNull();
	});
});

describe("parseGetFileResponse", () => {
	it("parses the file object itself", () => {
		expect(
			parseGetFileResponse({ path: "a.tpl", format: "text", content: "x" }),
		).toEqual({ path: "a.tpl", format: "text", content: "x" });
	});

	it("parses a `file` wrapper", () => {
		expect(
			parseGetFileResponse({
				file: { path: "a.json", format: "json", content: { k: 1 } },
			}),
		).toEqual({ path: "a.json", format: "json", content: { k: 1 } });
	});

	it("parses a one-item `files` list", () => {
		expect(
			parseGetFileResponse({
				files: [{ path: "a.tpl", format: "text", content: "x" }],
			}),
		).toEqual({ path: "a.tpl", format: "text", content: "x" });
	});

	it("throws when path or format is missing", () => {
		expect(() => parseGetFileResponse({ path: "a.tpl" })).toThrow(
			'Invalid API response: expected "path" and "format"',
		);
		expect(() => parseGetFileResponse("nope")).toThrow(
			"Invalid API response: expected JSON object",
		);
	});
});

describe("extractInstallationsArray", () => {
	it("accepts raw array", () => {
		expect(extractInstallationsArray([{ id: 1 }])).toHaveLength(1);
	});

	it("accepts { data: [] }", () => {
		expect(extractInstallationsArray({ data: [{ id: 2 }] })).toHaveLength(1);
	});

	it("accepts { installations: [] }", () => {
		expect(
			extractInstallationsArray({ installations: [{ id: 3 }] }),
		).toHaveLength(1);
	});
});

describe("extractThemeIdFromResponse", () => {
	it("returns id when present", () => {
		expect(extractThemeIdFromResponse({ id: 42 })).toBe("42");
	});

	it("falls back to installation_id", () => {
		expect(extractThemeIdFromResponse({ installation_id: 7 })).toBe("7");
	});

	it("returns null for non-object", () => {
		expect(extractThemeIdFromResponse(null)).toBeNull();
		expect(extractThemeIdFromResponse([1, 2])).toBeNull();
	});
});

describe("stringifyListInstallationsResponse", () => {
	it("rewrites installation fields to the EXT-518 base_theme vocabulary", () => {
		const body = {
			installations: [
				{
					id: 6_020_304,
					store_id: 5_012_345,
					title: "Installation 1",
					theme_id: 44,
					theme_name: "ipanema",
					theme_variant: null,
					theme_type: "sectionable",
					theme_version: "latest",
					is_productive: false,
					forked: false,
					revision_token: "abc",
					static_files_base_url: "/theme-static/5012345/6020304",
				},
			],
		};
		const out = stringifyListInstallationsResponse(body);
		const parsed = JSON.parse(out.trim()) as {
			themes: Record<string, unknown>[];
		};
		expect(parsed.themes).toHaveLength(1);
		const first = parsed.themes[0] as Record<string, unknown>;
		// installation's own id surfaces as theme_id
		expect(first.theme_id).toBe(6_020_304);
		expect(first.id).toBeUndefined();
		// base-catalog-theme descriptors carry the base_theme* prefix
		expect(first.base_theme).toBe("ipanema");
		expect(first.base_theme_id).toBe(44);
		expect(first.base_theme_variant).toBeNull();
		expect(first.base_theme_type).toBe("sectionable");
		// legacy server keys are stripped
		expect(first.theme_name).toBeUndefined();
		expect(first.theme_variant).toBeUndefined();
		expect(first.theme_type).toBeUndefined();
		// Unrelated fields are preserved verbatim.
		expect(first.title).toBe("Installation 1");
		expect(first.revision_token).toBe("abc");
		expect(out).toContain('"themes"');
		expect(out).not.toContain('"installations"');
	});

	it("wraps bare array as themes and rewrites keys", () => {
		const out = stringifyListInstallationsResponse([
			{ id: 1, theme_id: 99, theme_name: "amazonas", theme_type: "v1" },
		]);
		expect(JSON.parse(out.trim())).toEqual({
			themes: [
				{
					theme_id: 1,
					base_theme_id: 99,
					base_theme: "amazonas",
					base_theme_type: "v1",
				},
			],
		});
	});
});

describe("parseInstallationsList", () => {
	it("returns id + boolean isProductive from array body", () => {
		expect(
			parseInstallationsList([
				{ id: 10, is_productive: true },
				{ id: 11, is_productive: false },
			]),
		).toEqual([
			{ id: "10", isProductive: true },
			{ id: "11", isProductive: false },
		]);
	});

	it("accepts { data: [] } and { installations: [] }", () => {
		expect(
			parseInstallationsList({ data: [{ id: 1, is_productive: true }] }),
		).toEqual([{ id: "1", isProductive: true }]);
		expect(parseInstallationsList({ installations: [{ id: 2 }] })).toEqual([
			{ id: "2", isProductive: false },
		]);
	});

	it("treats non-true is_productive as false (defensive)", () => {
		expect(
			parseInstallationsList([
				{ id: 1, is_productive: "yes" },
				{ id: 2, is_productive: 1 },
				{ id: 3 },
			]),
		).toEqual([
			{ id: "1", isProductive: false },
			{ id: "2", isProductive: false },
			{ id: "3", isProductive: false },
		]);
	});

	it("falls back to installation_id and skips items without any id", () => {
		expect(
			parseInstallationsList([
				{ installation_id: 99, is_productive: true },
				{ is_productive: true },
			]),
		).toEqual([{ id: "99", isProductive: true }]);
	});
});

describe("formatInstallationsAsTextTable", () => {
	it("renders aligned columns with base_theme and base_theme_type headers", () => {
		const text = formatInstallationsAsTextTable([
			{
				id: 6_020_304,
				store_id: 5_012_345,
				title: "Installation 1",
				theme_id: 44,
				theme_name: "ipanema",
				theme_version: "latest",
				theme_type: "sectionable",
				is_productive: false,
				forked: false,
			},
		]);
		expect(text).toContain("6020304");
		// store_id is no longer a column (the caller prints it above the table)
		expect(text).not.toContain("5012345");
		expect(text).not.toContain("store_id");
		expect(text).toContain("Installation 1");
		expect(text).toContain("base_theme");
		expect(text).toContain("base_theme_type");
		// The base_theme cell shows the catalog name, not the numeric ID
		expect(text).toContain("ipanema");
		expect(text).not.toContain(" 44 ");
		// No variant on this item → shows N/A
		expect(text).toContain("N/A");
		// Old column names are gone
		expect(text).not.toMatch(/(^|\s)theme_id(\s|$)/);
		expect(text).not.toMatch(/(^|\s)theme_type(\s|$)/);
		expect(text).toMatch(/Total: 1/);
	});

	it("shows the variant column and reads version from the `version` field", () => {
		const text = formatInstallationsAsTextTable([
			{
				id: 12_240_598,
				store_id: 7_494_913,
				title: "multiple1",
				theme_id: 42,
				theme_name: "ipanema",
				theme_variant: "Clothing",
				theme_type: "sectionable",
				version: "forked",
				is_productive: false,
				forked: true,
			},
		]);
		expect(text).toContain("base_theme_variant");
		expect(text).toContain("Clothing");
		expect(text).toContain("forked");
		expect(text).toContain("12240598");
		expect(text).toContain("ipanema");
		// base theme id (42) is not shown as the row id
		expect(text).not.toMatch(/(^|\s)42(\s|$)/);
	});

	it("renders the archived column with yes/no from the `archived` field", () => {
		const text = formatInstallationsAsTextTable([
			{
				id: 6_020_304,
				store_id: 5_012_345,
				title: "Installation 1",
				theme_name: "ipanema",
				theme_type: "sectionable",
				is_productive: false,
				forked: false,
				archived: true,
			},
		]);
		expect(text).toContain("archived");
		expect(text).toMatch(/yes\s*$/m);
	});

	it("marks the current installation with > and leaves others blank", () => {
		const text = formatInstallationsAsTextTable(
			[
				{ id: 111, title: "one", theme_name: "ipanema" },
				{ id: 222, title: "two", theme_name: "ipanema" },
			],
			{ currentId: "222" },
		);
		const rows = text.split("\n");
		const currentRow = rows.find((r) => r.includes("222"));
		const otherRow = rows.find((r) => r.includes("111"));
		expect(currentRow?.trimStart().startsWith(">")).toBe(true);
		expect(otherRow).not.toContain(">");
	});

	it("draws no marker when there is no current installation", () => {
		const text = formatInstallationsAsTextTable([
			{ id: 111, title: "one", theme_name: "ipanema" },
		]);
		expect(text).not.toContain(">");
	});

	it("shows N/A for a blank version and variant", () => {
		const text = formatInstallationsAsTextTable([
			{
				id: 6_020_304,
				store_id: 5_012_345,
				title: "Installation 1",
				theme_name: "ipanema",
				theme_type: "sectionable",
				is_productive: false,
				forked: false,
			},
		]);
		// Both the version and variant cells fall back to N/A
		expect(text.match(/N\/A/g)?.length).toBe(2);
	});
});
