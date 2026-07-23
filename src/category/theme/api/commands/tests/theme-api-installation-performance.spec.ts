import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationPerformanceCommand } from "../theme-api-installation-performance";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

const lighthouseMocks = vi.hoisted(() => ({
	runThemePerformanceAudits: vi.fn(),
}));

vi.mock("../../theme-api-lighthouse", () => ({
	runThemePerformanceAudits: lighthouseMocks.runThemePerformanceAudits,
}));

function lhrWithScore(score: number) {
	return {
		finalDisplayedUrl:
			"https://fixture-preview.example.org/?theme_installation_id=42",
		categories: {
			performance: {
				score,
				auditRefs: [
					{ id: "first-contentful-paint", group: "metrics" },
					{ id: "unused-javascript", group: "diagnostics" },
				],
			},
		},
		audits: {
			"first-contentful-paint": {
				displayValue: "1.2 s",
				numericValue: 1200,
				score: 0.95,
			},
			"unused-javascript": {
				title: "Reduce unused JavaScript",
				description:
					"Reduce unused JS. [Learn more](https://web.dev/unused-js).",
				score: 0,
				displayValue: "Est savings of 1,399 KiB",
				details: {
					type: "opportunity",
					overallSavingsMs: 1500,
					items: [
						{ url: "https://cdn.example.com/vendor.js", wastedBytes: 104448 },
					],
				},
			},
		},
	};
}

const FIXTURE_AUDITS = [
	{ device: "mobile" as const, lhr: lhrWithScore(0.92) },
	{ device: "desktop" as const, lhr: lhrWithScore(0.99) },
];

function completeConfig(themeId = "42") {
	return {
		success: true as const,
		config: {
			publicApiToken: "t",
			storeId: "1",
			themeId,
			storeUrl: "https://fixture-preview.example.org",
		},
	};
}

describe("ThemeApiInstallationPerformanceCommand", () => {
	let stdoutSpy: StdoutWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		lighthouseMocks.runThemePerformanceAudits.mockReset();
		lighthouseMocks.runThemePerformanceAudits.mockResolvedValue(FIXTURE_AUDITS);
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
	});

	it("errors when config cannot be loaded and never runs the audit", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
		expect(lighthouseMocks.runThemePerformanceAudits).not.toHaveBeenCalled();
	});

	it("errors when no theme id can be resolved", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
		expect(lighthouseMocks.runThemePerformanceAudits).not.toHaveBeenCalled();
	});

	it("errors when store_url is missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1", themeId: "42" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No store_url in .nuvem: re-run tiendanube theme authorize to save your storefront URL (e.g. https://your-store.nuvemshop.com.br).",
		);
		expect(lighthouseMocks.runThemePerformanceAudits).not.toHaveBeenCalled();
	});

	it("audits both devices by default and prints a report per device", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);

		expect(lighthouseMocks.runThemePerformanceAudits).toHaveBeenCalledWith(
			"https://fixture-preview.example.org/?theme_installation_id=42",
			["mobile", "desktop"],
		);
		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).toContain("Theme performance report — Mobile");
		expect(written).toContain("Theme performance report — Desktop");
		expect(written).toContain("92 / 100");
		expect(written).toContain("99 / 100");
	});

	it("audits only mobile with --device mobile", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		lighthouseMocks.runThemePerformanceAudits.mockResolvedValue([
			FIXTURE_AUDITS[0],
		]);
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"performance",
			"--device",
			"mobile",
		]);

		expect(lighthouseMocks.runThemePerformanceAudits).toHaveBeenCalledWith(
			"https://fixture-preview.example.org/?theme_installation_id=42",
			["mobile"],
		);
		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).toContain("Theme performance report — Mobile");
		expect(written).not.toContain("Theme performance report — Desktop");
	});

	it("audits only desktop with --device desktop", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		lighthouseMocks.runThemePerformanceAudits.mockResolvedValue([
			FIXTURE_AUDITS[1],
		]);
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"performance",
			"--device",
			"desktop",
		]);

		expect(lighthouseMocks.runThemePerformanceAudits).toHaveBeenCalledWith(
			"https://fixture-preview.example.org/?theme_installation_id=42",
			["desktop"],
		);
	});

	it("prints machine-readable JSON with --json and keeps stdout JSON-only", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance", "--json"]);

		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).not.toContain("Theme performance report");
		const parsed = JSON.parse(written);
		expect(parsed.theme_id).toBe("42");
		expect(parsed.url).toBe(
			"https://fixture-preview.example.org/?theme_installation_id=42",
		);
		expect(parsed.results.mobile.performance_score).toBe(92);
		expect(parsed.results.desktop.performance_score).toBe(99);
		// JSON mode must not narrate progress on stdout.
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("appends recommended changes for each device with --detailed", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance", "--detailed"]);

		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).toContain("Recommended changes");
		expect(written).toContain("Reduce unused JavaScript");
		// The doc link is on the title line; the description prose is not rendered.
		expect(written).toContain("https://web.dev/unused-js");
		expect(written).not.toContain("Reduce unused JS.");
		// The concrete offending resource is listed as an example.
		expect(written).toContain("https://cdn.example.com/vendor.js");
	});

	it("omits recommended changes without --detailed", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);

		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).not.toContain("Recommended changes");
	});

	it("includes recommendations in JSON with --detailed --json", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"performance",
			"--detailed",
			"--json",
		]);

		const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		const parsed = JSON.parse(written);
		expect(parsed.results.mobile.recommendations[0].id).toBe(
			"unused-javascript",
		);
		expect(parsed.results.desktop.recommendations[0].title).toBe(
			"Reduce unused JavaScript",
		);
		expect(parsed.results.mobile.recommendations[0].examples[0]).toEqual({
			label: "https://cdn.example.com/vendor.js",
			detail: "102 KiB",
		});
		expect(parsed.results.mobile.recommendations[0].learn_more_url).toBe(
			"https://web.dev/unused-js",
		);
	});

	it("wraps audit failures in a friendly CLI error", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		lighthouseMocks.runThemePerformanceAudits.mockRejectedValue(
			new Error("Chrome exited"),
		);
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPerformanceCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "performance"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Performance analysis failed: Chrome exited",
		);
	});
});
