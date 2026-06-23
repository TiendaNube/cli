import { describe, expect, it } from "vitest";
import {
	validateBaseThemeCode,
	validateThemeId,
} from "./theme-api-prompt-validators";

describe("validateThemeId", () => {
	it("accepts numeric ids (with surrounding whitespace)", () => {
		expect(validateThemeId("123")).toBeUndefined();
		expect(validateThemeId("  4542075  ")).toBeUndefined();
	});

	it("rejects non-numeric ids", () => {
		expect(validateThemeId("abc")).toBeTruthy();
		expect(validateThemeId("12a")).toBeTruthy();
		expect(validateThemeId("")).toBeTruthy();
	});
});

describe("validateBaseThemeCode", () => {
	it("accepts lowercase slug-like codes with hyphens and underscores", () => {
		expect(validateBaseThemeCode("ipanema")).toBeUndefined();
		expect(validateBaseThemeCode("base-theme-2")).toBeUndefined();
		expect(validateBaseThemeCode("base_theme_2")).toBeUndefined();
	});

	it("rejects uppercase, spaces, and other characters", () => {
		expect(validateBaseThemeCode("Ipanema")).toBeTruthy();
		expect(validateBaseThemeCode("base theme")).toBeTruthy();
		expect(validateBaseThemeCode("x.y")).toBeTruthy();
		expect(validateBaseThemeCode("")).toBeTruthy();
	});
});
