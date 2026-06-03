import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_INSTALLATION_PREVIEW_QUERY } from "../../theme-api-preview-url";
import { ThemeApiInstallationPreviewCommand } from "../theme-api-installation-preview";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationPreviewCommand", () => {
	let stderrSpy: StderrWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		stderrSpy.mockRestore();
	});

	it("errors when config cannot be loaded", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "preview"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when no theme id in config or CLI", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "preview"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("errors when store_url missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "99",
			},
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "preview"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No store_url in .nuvem: re-run tiendanube theme authorize to save your storefront URL (e.g. https://your-store.nuvemshop.com.br).",
		);
	});

	it("logs preview URL when config is complete", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "9001002",
				storeUrl: "https://fixture-preview.example.org",
			},
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "preview"]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			`https://fixture-preview.example.org/?${THEME_INSTALLATION_PREVIEW_QUERY}=9001002`,
		);
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				storeUrl: "https://fixture-preview.example.org",
			},
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"preview",
			"--installation-id",
			"42",
		]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			`https://fixture-preview.example.org/?${THEME_INSTALLATION_PREVIEW_QUERY}=42`,
		);
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
	});

	it("resolves theme via --published and prints URL", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				storeUrl: "https://fixture-preview.example.org",
			},
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 654321, is_productive: true },
			],
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPreviewCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "preview", "--published"]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			`https://fixture-preview.example.org/?${THEME_INSTALLATION_PREVIEW_QUERY}=654321`,
		);
	});
});
