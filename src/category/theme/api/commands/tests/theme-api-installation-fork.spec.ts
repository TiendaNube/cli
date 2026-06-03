import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationForkCommand } from "../theme-api-installation-fork";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationForkCommand", () => {
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
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "fork", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when theme id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "fork", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("calls forkInstallation with -y", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "10",
			},
		};
		themeApiCmdMocks.forkInstallation.mockResolvedValue({ fork: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "fork", "-y"]);
		expect(themeApiCmdMocks.forkInstallation).toHaveBeenCalledWith("10");
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme 10 forked successfully; fork is now true.",
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
		themeApiCmdMocks.forkInstallation.mockResolvedValue({ fork: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "fork", "-y", "--json"]);
		expect(stdoutSpy).toHaveBeenCalled();
		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(JSON.parse(written)).toEqual({ fork: true });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("resolves theme via --published and forks it", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 333, is_productive: true },
			],
		});
		themeApiCmdMocks.forkInstallation.mockResolvedValue({ fork: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "fork", "--published", "-y"]);
		expect(themeApiCmdMocks.forkInstallation).toHaveBeenCalledWith("333");
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.forkInstallation.mockResolvedValue({ fork: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationForkCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"fork",
			"--installation-id",
			"77",
			"-y",
		]);
		expect(themeApiCmdMocks.forkInstallation).toHaveBeenCalledWith("77");
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
	});
});
