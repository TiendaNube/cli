import "./theme-api-command-test-mocks";
import { vi } from "vitest";

const chokidarWatch = vi.hoisted(() => vi.fn());

vi.mock("chokidar", () => ({
	default: {
		watch: chokidarWatch,
	},
}));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeApiWatchCommand } from "../theme-api-watch";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiWatchCommand", () => {
	let stderrSpy: StderrWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		chokidarWatch.mockReturnValue({
			on: vi.fn().mockReturnThis(),
		});
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		chokidarWatch.mockReset();
		stderrSpy.mockRestore();
	});

	it("errors when TryLoadApiConfig fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiWatchCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "watch", "--no-browser"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
		expect(chokidarWatch).not.toHaveBeenCalled();
	});

	it("errors when theme id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiWatchCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "watch", "--no-browser"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("starts chokidar when config and theme ok with --no-browser", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "5",
			},
		};
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiWatchCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "watch", "--no-browser"]);
		expect(themeApiCmdMocks.getInstallation).toHaveBeenCalledWith("5");
		expect(chokidarWatch).toHaveBeenCalled();
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiWatchCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"watch",
			"--installation-id",
			"77",
			"--no-browser",
		]);
		expect(themeApiCmdMocks.getInstallation).toHaveBeenCalledWith("77");
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
	});

	it("resolves theme via --published and watches it", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 888, is_productive: true },
			],
		});
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		const program = programWithThemeCommand((c) => {
			new ThemeApiWatchCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"watch",
			"--published",
			"--no-browser",
		]);
		expect(themeApiCmdMocks.getInstallation).toHaveBeenCalledWith("888");
		expect(chokidarWatch).toHaveBeenCalled();
	});
});
