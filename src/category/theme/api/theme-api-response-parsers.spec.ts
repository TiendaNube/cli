import { describe, expect, it } from "vitest";
import {
	extractInstallationsArray,
	extractThemeIdFromResponse,
	formatInstallationsAsTextTable,
	parseGetFilesResponse,
	parseInstallationsList,
	stringifyListInstallationsResponse,
} from "./theme-api-response-parsers";

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
		expect(text).toContain("5012345");
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
