import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationPublishCommand } from "../theme-api-installation-publish";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationPublishCommand", () => {
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
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "publish", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when theme id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "publish", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("returns early when user declines confirm", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "10",
			},
		};
		themeApiCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "publish"]);
		expect(themeApiCmdMocks.publishInstallation).not.toHaveBeenCalled();
	});

	it("calls publishInstallation with -y", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "10",
			},
		};
		themeApiCmdMocks.publishInstallation.mockResolvedValue({});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "publish", "-y"]);
		expect(themeApiCmdMocks.publishInstallation).toHaveBeenCalledWith("10");
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme 10 published successfully; it is now productive.",
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
		themeApiCmdMocks.publishInstallation.mockResolvedValue({
			is_productive: true,
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "publish", "-y", "--json"]);
		expect(stdoutSpy).toHaveBeenCalled();
		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(JSON.parse(written)).toEqual({ is_productive: true });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.publishInstallation.mockResolvedValue({});
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationPublishCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"publish",
			"--installation-id",
			"77",
			"-y",
		]);
		expect(themeApiCmdMocks.publishInstallation).toHaveBeenCalledWith("77");
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
	});
});
