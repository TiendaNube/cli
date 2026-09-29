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

	it("prints the store id above the table and marks the current theme", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1234", themeId: "222" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: "111", title: "one", theme_name: "ipanema" },
				{ id: "222", title: "two", theme_name: "ipanema" },
			],
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list"]);

		const logged = themeApiCmdMocks.log.mock.calls.map((c) => String(c[0]));
		expect(logged.some((l) => l.includes("Store id: 1234"))).toBe(true);
		// store id is not repeated as a table column
		const table = logged.find((l) => l.includes("111")) ?? "";
		expect(table).not.toContain("store_id");
		const currentRow = table.split("\n").find((r) => r.includes("222"));
		expect(currentRow?.trimStart().startsWith(">")).toBe(true);
	});

	it("prints the plan limit below the table when the API sends it", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: "111", title: "one" },
				{ id: "222", title: "two", archived: true },
			],
			meta: { max_installations: 2 },
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list"]);

		const logged = themeApiCmdMocks.log.mock.calls.map((c) => String(c[0]));
		expect(logged.at(-1)).toBe(
			"Limit: 1 of 2 themes in use (archived themes don't count)",
		);
	});

	it("prints no limit line when the API sends no limit", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [{ id: "111", title: "one" }],
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list"]);

		const logged = themeApiCmdMocks.log.mock.calls.map((c) => String(c[0]));
		expect(logged.some((l) => l.startsWith("Limit:"))).toBe(false);
	});

	it("keeps meta.max_installations unchanged in --json", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [{ id: "1", title: "A" }],
			meta: { max_installations: 6 },
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationListCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "list", "--json"]);

		const written = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0] ?? ""));
		expect(written.meta).toEqual({ max_installations: 6 });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
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
