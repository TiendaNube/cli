import "./theme-api-command-test-mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeApiInstallationCurrentCommand } from "../theme-api-installation-current";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationCurrentCommand", () => {
	beforeEach(() => {
		resetThemeApiCmdMocks();
	});

	it("errors when config load fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCurrentCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "current"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when themeId is missing from .nuvem", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCurrentCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "current"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id saved for the current folder. Run tiendanube theme pull --theme-id <id>",
		);
	});

	it("prints the saved themeId", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiInstallationCurrentCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "current"]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Current theme id is 4542075.",
		);
	});
});
