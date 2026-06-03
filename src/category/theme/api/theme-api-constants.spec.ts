import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveThemeApiBaseUrl } from "./theme-api-constants";

describe("resolveThemeApiBaseUrl", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("prefers cli URL over config", () => {
		expect(
			resolveThemeApiBaseUrl({
				cliUrl: "https://cli.example/",
				configUrl: "https://config.example",
			}),
		).toBe("https://cli.example");
	});

	it("uses config when cli is empty", () => {
		expect(
			resolveThemeApiBaseUrl({
				configUrl: "https://cfg.example/staging/",
			}),
		).toBe("https://cfg.example/staging");
	});
});
