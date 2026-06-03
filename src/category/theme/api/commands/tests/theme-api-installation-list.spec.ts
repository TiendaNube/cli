import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationListCommand } from "../theme-api-installation-list";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationListCommand", () => {
	let stdoutSpy: StdoutWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
	});

	it("logs error when TryLoadApiConfig fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("writes JSON when --json", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [{ id: "1", title: "A" }],
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list", "--json"]);
		expect(stdoutSpy).toHaveBeenCalled();
		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(written).toContain("themes");
		expect(written).not.toContain("installations");
	});

	it("logs empty message when no theme rows", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list"]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"No themes returned (empty list).",
		);
	});
});
