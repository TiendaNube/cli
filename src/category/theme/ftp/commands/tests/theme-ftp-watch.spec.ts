import "./theme-ftp-command-test-mocks";
import { vi } from "vitest";

const chokidarWatch = vi.hoisted(() => vi.fn());

vi.mock("chokidar", () => ({
	default: {
		watch: chokidarWatch,
	},
}));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeFtpWatchCommand } from "../theme-ftp-watch";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import { ftpCmdMocks, resetFtpCmdMocks } from "./theme-ftp-command-test-mocks";

describe("ThemeFtpWatchCommand", () => {
	beforeEach(() => {
		resetFtpCmdMocks();
		chokidarWatch.mockReturnValue({
			on: vi.fn().mockReturnThis(),
		});
	});

	afterEach(() => {
		chokidarWatch.mockReset();
	});

	it("errors when configuration is not set", async () => {
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpWatchCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "watch", "--no-browser"]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Store configuration not found. Please run tiendanube theme ftp setup first.",
		);
		expect(chokidarWatch).not.toHaveBeenCalled();
	});

	it("starts chokidar when config loaded with --no-browser", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = {
			success: true,
			config: {
				ftp: {
					ftpServer: "s",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: "https://shop.example.com",
			},
		};
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpWatchCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "watch", "--no-browser"]);
		expect(chokidarWatch).toHaveBeenCalled();
	});
});
