import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationCreateCommand } from "../theme-api-installation-create";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationCreateCommand", () => {
	let stdoutSpy: StdoutWriteSpy;
	let stderrSpy: StderrWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	it("errors when config load fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"x",
			"--title",
			"y",
		]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors on empty base-theme passed via flag (validation layer)", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await expect(
			parseWithTail(program, [
				"theme",
				"create",
				"--base-theme",
				"   ",
				"--title",
				"   ",
			]),
		).rejects.toThrow("This value is required.");
		expect(themeApiCmdMocks.createInstallation).not.toHaveBeenCalled();
	});

	it("errors on a malformed base-theme code passed via flag", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await expect(
			parseWithTail(program, [
				"theme",
				"create",
				"--base-theme",
				"Ipanema",
				"--title",
				"My theme",
			]),
		).rejects.toThrow(
			"Base theme code must be lowercase letters, digits, hyphens or underscores (e.g. ipanema).",
		);
		expect(themeApiCmdMocks.createInstallation).not.toHaveBeenCalled();
	});

	it("logs success when API creates theme with --base-theme", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.createInstallation.mockResolvedValue({ id: "new" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"ipanema",
			"--title",
			"My theme",
		]);
		expect(themeApiCmdMocks.createInstallation).toHaveBeenCalledWith({
			theme_code: "ipanema",
			title: "My theme",
		});
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme new created successfully.",
		);
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it("passes theme_variant when --base-theme-variant is valid", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.createInstallation.mockResolvedValue({ id: "new" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"ipanema",
			"--title",
			"My theme",
			"--base-theme-variant",
			"Clothing",
		]);
		expect(themeApiCmdMocks.createInstallation).toHaveBeenCalledWith({
			theme_code: "ipanema",
			title: "My theme",
			theme_variant: "Clothing",
		});
	});

	it("errors on a lowercase --base-theme-variant", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"ipanema",
			"--title",
			"My theme",
			"--base-theme-variant",
			"clothing",
		]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Base theme variant must contain only letters and start with an uppercase letter (e.g. Clothing).",
		);
		expect(themeApiCmdMocks.createInstallation).not.toHaveBeenCalled();
	});

	it("errors on a --base-theme-variant containing non-letters", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"ipanema",
			"--title",
			"My theme",
			"--base-theme-variant",
			"Clothing-store",
		]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Base theme variant must contain only letters and start with an uppercase letter (e.g. Clothing).",
		);
		expect(themeApiCmdMocks.createInstallation).not.toHaveBeenCalled();
	});

	it("accepts deprecated --theme-code and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.createInstallation.mockResolvedValue({ id: "new" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--theme-code",
			"ipanema",
			"--title",
			"My theme",
		]);
		expect(themeApiCmdMocks.createInstallation).toHaveBeenCalledWith({
			theme_code: "ipanema",
			title: "My theme",
		});
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--theme-code' is deprecated");
		expect(stderrText).toContain("--base-theme");
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme new created successfully.",
		);
	});

	it("prefers --base-theme over deprecated --theme-code when both are passed", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.createInstallation.mockResolvedValue({ id: "new" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"new-code",
			"--theme-code",
			"legacy-code",
			"--title",
			"My theme",
		]);
		expect(themeApiCmdMocks.createInstallation).toHaveBeenCalledWith({
			theme_code: "new-code",
			title: "My theme",
		});
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it("writes JSON when --json", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.createInstallation.mockResolvedValue({ id: "new" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCreateCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"create",
			"--base-theme",
			"ipanema",
			"--title",
			"My theme",
			"--json",
		]);
		expect(stdoutSpy).toHaveBeenCalled();
		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(JSON.parse(written)).toEqual({ id: "new" });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});
});
