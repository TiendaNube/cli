import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationCloneCommand } from "../theme-api-installation-clone";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationCloneCommand", () => {
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
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when theme id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("calls cloneInstallation with -y and logs new id in text mode", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "10",
			},
		};
		themeApiCmdMocks.cloneInstallation.mockResolvedValue({ id: "11" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "-y"]);
		expect(themeApiCmdMocks.cloneInstallation).toHaveBeenCalledWith("10");
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme 10 cloned successfully; new theme 11 was created.",
		);
	});

	it("writes JSON when --json", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "10",
			},
		};
		themeApiCmdMocks.cloneInstallation.mockResolvedValue({ id: "11" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "-y", "--json"]);
		expect(stdoutSpy).toHaveBeenCalled();
		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(JSON.parse(written)).toEqual({ id: "11" });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("resolves theme via --published", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 200, is_productive: true },
			],
		});
		themeApiCmdMocks.cloneInstallation.mockResolvedValue({ id: "300" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "--published", "-y"]);
		expect(themeApiCmdMocks.cloneInstallation).toHaveBeenCalledWith("200");
	});

	it("errors when --published combined with --theme-id", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"clone",
			"--published",
			"--theme-id",
			"5",
			"-y",
		]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"--published cannot be combined with --theme-id",
		);
		expect(themeApiCmdMocks.cloneInstallation).not.toHaveBeenCalled();
	});

	it("errors when no productive theme exists", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [{ id: 100, is_productive: false }],
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "clone", "--published", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No productive theme found for this store",
		);
		expect(themeApiCmdMocks.cloneInstallation).not.toHaveBeenCalled();
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.cloneInstallation.mockResolvedValue({ id: "12" });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCloneCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"clone",
			"--installation-id",
			"77",
			"-y",
		]);
		expect(themeApiCmdMocks.cloneInstallation).toHaveBeenCalledWith("77");
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
	});
});
