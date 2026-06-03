import { describe, expect, it } from "vitest";
import {
	canPushRelativePathWhenNotForked,
	isInstallationForked,
} from "./theme-api-fork-rules";

describe("theme-api-fork-rules", () => {
	it("allows custom and templates when not forked", () => {
		expect(canPushRelativePathWhenNotForked("custom/foo.tpl")).toBe(true);
		expect(canPushRelativePathWhenNotForked("templates/x.json")).toBe(true);
		expect(canPushRelativePathWhenNotForked("config/settings_data.json")).toBe(
			true,
		);
	});

	it("blocks arbitrary theme paths when not forked", () => {
		expect(canPushRelativePathWhenNotForked("layouts/theme.tpl")).toBe(false);
	});

	it("isInstallationForked is true only when forked flag is true", () => {
		expect(isInstallationForked({ forked: true })).toBe(true);
		expect(isInstallationForked({ forked: false })).toBe(false);
		expect(isInstallationForked({})).toBe(false);
	});
});
