import "./theme-ftp-command-test-mocks";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FsReaddirSyncSpy,
	spyFsReaddirSyncMockNames,
} from "../../../api/commands/tests/fs-readdir-sync-spy";
import { ThemeFtpPullCommand } from "../theme-ftp-pull";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import { ftpCmdMocks, resetFtpCmdMocks } from "./theme-ftp-command-test-mocks";

const validFtpConfig = {
	ftp: {
		ftpServer: "s",
		ftpUsername: "u",
		ftpPassword: "p",
		verbose: false,
	},
	storeUrl: "https://shop.example.com",
} as const;

describe("ThemeFtpPullCommand", () => {
	let readdirSpy: FsReaddirSyncSpy;

	beforeEach(() => {
		resetFtpCmdMocks();
		readdirSpy = spyFsReaddirSyncMockNames([".nuvem"]);
	});

	afterEach(() => {
		readdirSpy.mockRestore();
	});

	it("errors when configuration is not set", async () => {
		ftpCmdMocks.isSet = false;
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull", "-y"]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Store configuration not found. Please run tiendanube theme ftp setup first.",
		);
	});

	it("logs completion when download succeeds", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.downloadAll.mockResolvedValue({ success: true });
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull", "-y"]);
		expect(ftpCmdMocks.downloadAll).toHaveBeenCalled();
		expect(ftpCmdMocks.log).toHaveBeenCalledWith("Download completed");
	});

	it("cleans non-hidden entries before downloading and preserves dot-hidden entries", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.downloadAll.mockResolvedValue({ success: true });
		readdirSpy.mockReturnValue(["assets", "templates", ".nuvem", ".git"]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull", "-y"]);

		const removed = rmSpy.mock.calls.map((call) =>
			path.basename(String(call[0])),
		);
		expect(removed.sort()).toEqual(["assets", "templates"]);
		expect(removed).not.toContain(".nuvem");
		expect(removed).not.toContain(".git");
		expect(ftpCmdMocks.downloadAll).toHaveBeenCalled();

		rmSpy.mockRestore();
	});

	it("skips confirm and cleanup when workspace has only hidden entries", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.downloadAll.mockResolvedValue({ success: true });
		readdirSpy.mockReturnValue([".nuvem", ".git"]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull"]);

		expect(ftpCmdMocks.confirm).not.toHaveBeenCalled();
		expect(rmSpy).not.toHaveBeenCalled();
		expect(ftpCmdMocks.downloadAll).toHaveBeenCalled();

		rmSpy.mockRestore();
	});

	it("aborts without cleaning or downloading when user declines confirm", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		readdirSpy.mockReturnValue(["assets", ".nuvem"]);
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull"]);

		expect(ftpCmdMocks.confirm).toHaveBeenCalled();
		expect(rmSpy).not.toHaveBeenCalled();
		expect(ftpCmdMocks.downloadAll).not.toHaveBeenCalled();

		rmSpy.mockRestore();
	});

	it("cleans without prompting when -y is set", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.downloadAll.mockResolvedValue({ success: true });
		readdirSpy.mockReturnValue(["assets", ".nuvem"]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPullCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "pull", "-y"]);

		expect(ftpCmdMocks.confirm).not.toHaveBeenCalled();
		expect(rmSpy).toHaveBeenCalledTimes(1);
		expect(path.basename(String(rmSpy.mock.calls[0][0]))).toBe("assets");
		expect(ftpCmdMocks.downloadAll).toHaveBeenCalled();

		rmSpy.mockRestore();
	});
});
