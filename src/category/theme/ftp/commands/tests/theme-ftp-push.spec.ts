import "./theme-ftp-command-test-mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeFtpPushCommand } from "../theme-ftp-push";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import {
	forceInteractiveTestEnv,
	ftpCmdMocks,
	resetFtpCmdMocks,
} from "./theme-ftp-command-test-mocks";

const validFtpConfig = {
	ftp: {
		ftpServer: "s",
		ftpUsername: "u",
		ftpPassword: "p",
		verbose: false,
	},
	storeUrl: "https://shop.example.com",
} as const;

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
		forceInteractiveTestEnv();
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "--force"]);
		expect(ftpCmdMocks.confirm).toHaveBeenCalled();
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
	});

	it("refuses to upload a tree that was pulled over the API", async () => {
		// The workspace holds both credential families, so these files may be a
		// sections-based theme; uploading them over FTP would overwrite a classic
		// theme with the wrong kind of files.
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.lastSync = "api";
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "-y"]);
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("last pulled over Public API"),
		);
	});

	it("allows the push when the recorded origin is FTP or unrecorded", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.syncAll.mockResolvedValue({ success: true });

		for (const origin of ["ftp", undefined] as const) {
			ftpCmdMocks.syncAll.mockClear();
			ftpCmdMocks.lastSync = origin;
			const program = programWithFtpSubcommand((c) => {
				new ThemeFtpPushCommand().Bind(c);
			});
			await parseWithTail(program, ["ftp", "push", "-y"]);
			expect(ftpCmdMocks.syncAll, `origin=${origin}`).toHaveBeenCalled();
		}
	});

	it("names the mismatch in the confirmation when --force overrides it", async () => {
		// --force unlocks the upload; it must not do so silently.
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = { success: true, config: validFtpConfig };
		ftpCmdMocks.lastSync = "api";
		forceInteractiveTestEnv();
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "--force"]);
		expect(ftpCmdMocks.confirm).toHaveBeenCalledWith(
			expect.stringContaining("last pulled over Public API"),
		);
	});
});
