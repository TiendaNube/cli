import { describe, expect, it } from "vitest";
import {
	THEME_INSTALLATION_PREVIEW_QUERY,
	buildThemeInstallationPreviewUrl,
} from "./theme-api-preview-url";

describe("buildThemeInstallationPreviewUrl", () => {
	it("appends theme_installation_id query to origin without existing query", () => {
		expect(
			buildThemeInstallationPreviewUrl(
				"https://fixture-vitrine.example.org",
				"9001001",
			),
		).toBe(
			`https://fixture-vitrine.example.org/?${THEME_INSTALLATION_PREVIEW_QUERY}=9001001`,
		);
	});

	it("merges with existing query string", () => {
		const out = buildThemeInstallationPreviewUrl(
			"https://shop.example.com/path?foo=1",
			"99",
		);
		const parsed = new URL(out);
		expect(parsed.searchParams.get("foo")).toBe("1");
		expect(parsed.searchParams.get(THEME_INSTALLATION_PREVIEW_QUERY)).toBe(
			"99",
		);
	});

	it("rejects relative store_url", () => {
		expect(() => buildThemeInstallationPreviewUrl("not-a-url", "1")).toThrow(
			/absolute URL/i,
		);
	});
});
