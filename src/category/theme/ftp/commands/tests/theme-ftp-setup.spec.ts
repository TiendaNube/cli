import "./theme-ftp-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FsReaddirSyncSpy,
	spyFsReaddirSyncMockNames,
} from "../../../api/commands/tests/fs-readdir-sync-spy";
import { ThemeFtpSetupCommand } from "../theme-ftp-setup";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import { ftpCmdMocks, resetFtpCmdMocks } from "./theme-ftp-command-test-mocks";

describe("ThemeFtpSetupCommand", () => {
	let readdirSpy: FsReaddirSyncSpy;

	beforeEach(() => {
		resetFtpCmdMocks();
		readdirSpy = spyFsReaddirSyncMockNames([]);
	});

	afterEach(() => {
		readdirSpy.mockRestore();
	});

	it("errors when FTP test fails", async () => {
		ftpCmdMocks.testFtp.mockResolvedValue({
			success: false,
			errorMessage: "conn refused",
		});
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpSetupCommand().Bind(c);
		});
		await parseWithTail(program, [
			"ftp",
			"setup",
			"--ftp-server",
			"ftp://x",
			"--ftp-username",
			"u",
			"--ftp-password",
			"p",
			"--store-url",
			"https://shop.example.com",
			"-y",
		]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"FTP connection failed: conn refused",
		);
		expect(ftpCmdMocks.save).not.toHaveBeenCalled();
	});

	it("saves configuration when FTP test succeeds", async () => {
		ftpCmdMocks.testFtp.mockResolvedValue({ success: true });
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpSetupCommand().Bind(c);
		});
		await parseWithTail(program, [
			"ftp",
			"setup",
			"--ftp-server",
			"ftp://host",
			"--ftp-username",
			"u",
			"--ftp-password",
			"pw",
			"--store-url",
			"https://shop.example.com",
			"-y",
		]);
		expect(ftpCmdMocks.save).toHaveBeenCalled();
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Store configuration file saved. You can now use theme ftp pull, theme ftp push, and theme ftp watch.",
		);
	});
});
