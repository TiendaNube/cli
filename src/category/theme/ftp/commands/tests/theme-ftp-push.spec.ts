import "./theme-ftp-command-test-mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeFtpPushCommand } from "../theme-ftp-push";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import { ftpCmdMocks, resetFtpCmdMocks } from "./theme-ftp-command-test-mocks";

describe("ThemeFtpPushCommand", () => {
	beforeEach(() => {
		resetFtpCmdMocks();
	});

	it("errors when configuration is not set", async () => {
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "-y"]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Store configuration not found. Please run tiendanube theme ftp setup first.",
		);
	});

	it("returns when user declines overwrite confirm", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push"]);
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
	});

	it("calls SyncAll when sync succeeds", async () => {
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
		ftpCmdMocks.syncAll.mockResolvedValue({ success: true });
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "-y"]);
		expect(ftpCmdMocks.syncAll).toHaveBeenCalledWith(false);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Starting sync with FTP server",
		);
	});

	it("calls SyncAll with force=true and logs force message when --force is passed", async () => {
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
		ftpCmdMocks.syncAll.mockResolvedValue({ success: true });
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "-y", "--force"]);
		expect(ftpCmdMocks.syncAll).toHaveBeenCalledWith(true);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Starting sync with FTP server (--force: uploading all files)",
		);
	});

	it("shows confirmation prompt when --force is used without -y", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "--force"]);
		expect(ftpCmdMocks.confirm).toHaveBeenCalled();
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
	});
});
