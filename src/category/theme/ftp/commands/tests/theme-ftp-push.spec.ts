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
		// The diff computed for the confirmation is handed to SyncAll so the remote
		// tree is listed once rather than twice.
		expect(ftpCmdMocks.computeDiff).toHaveBeenCalledWith(false);
		expect(ftpCmdMocks.syncAll).toHaveBeenCalledWith(
			false,
			await ftpCmdMocks.computeDiff.mock.results[0]?.value,
		);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Starting sync with FTP server",
		);
	});

	it("states the live target and the counts in the confirmation", async () => {
		ftpCmdMocks.isSet = true;
		forceInteractiveTestEnv();
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
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: true,
			toCreate: ["/w/a.tpl"],
			toUpdate: ["/w/b.tpl", "/w/c.tpl"],
			toDelete: ["/gone.tpl"],
			skippedEmpty: [],
			unchangedCount: 9,
		});
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push"]);
		const prompt = String(ftpCmdMocks.confirm.mock.calls[0]?.[0] ?? "");
		// A blind "are you sure?" was the whole problem: FTP writes to the published
		// theme with no preview, so the counts have to be in the question itself.
		expect(prompt).toMatch(/published in your store/);
		expect(prompt).toMatch(/shoppers see it immediately/);
		expect(prompt).toContain("1 file(s) to add");
		expect(prompt).toContain("2 to modify");
		expect(prompt).toContain("1 to delete");
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
	});

	it("logs the counts under -y, where the confirmation never renders", async () => {
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
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: true,
			toCreate: [],
			toUpdate: ["/w/a.tpl"],
			toDelete: ["/gone.tpl", "/gone2.tpl"],
			skippedEmpty: [],
			unchangedCount: 0,
		});
		ftpCmdMocks.syncAll.mockResolvedValue({ success: true });
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "-y"]);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Pending changes: 0 file(s) to add, 1 to modify, and 2 to delete from the remote theme.",
		);
	});

	it("says the summary is skipped when --force asks for no review", async () => {
		// --force is an explicit "upload everything, do not tell me what changes",
		// so the prompt must not pretend a change set was reviewed.
		ftpCmdMocks.isSet = true;
		forceInteractiveTestEnv();
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
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push", "--force"]);
		const prompt = String(ftpCmdMocks.confirm.mock.calls[0]?.[0] ?? "");
		expect(prompt).toMatch(/change summary is skipped/);
		expect(prompt).toMatch(/published in your store/);
		expect(prompt).not.toMatch(/file\(s\) to add/);
		expect(ftpCmdMocks.computeDiff).not.toHaveBeenCalled();
	});

	it("logs nothing about pending changes when --force skips the diff", async () => {
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
		expect(ftpCmdMocks.log).not.toHaveBeenCalledWith(
			expect.stringContaining("Pending changes:"),
		);
	});

	it("does not repeat the counts in the log when it will ask", async () => {
		// Interactive runs read them in the prompt; logging too would double it.
		ftpCmdMocks.isSet = true;
		forceInteractiveTestEnv();
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
		ftpCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push"]);
		expect(ftpCmdMocks.log).not.toHaveBeenCalledWith(
			expect.stringContaining("Pending changes:"),
		);
	});

	it("aborts without asking when the pre-flight diff fails", async () => {
		// Asking about work whose scope is unknown would be worse than failing.
		ftpCmdMocks.isSet = true;
		forceInteractiveTestEnv();
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
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: false,
			errorMessage: "530 Login incorrect",
		});
		const program = programWithFtpSubcommand((c) => {
			new ThemeFtpPushCommand().Bind(c);
		});
		await parseWithTail(program, ["ftp", "push"]);
		expect(ftpCmdMocks.confirm).not.toHaveBeenCalled();
		expect(ftpCmdMocks.syncAll).not.toHaveBeenCalled();
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Sync failed: 530 Login incorrect",
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
		// --force opts out of the pre-flight entirely, so SyncAll gets no
		// precomputed diff and does its own listing.
		expect(ftpCmdMocks.computeDiff).not.toHaveBeenCalled();
		expect(ftpCmdMocks.syncAll).toHaveBeenCalledWith(true, undefined);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith(
			"Starting sync with FTP server (--force: uploading all files)",
		);
	});

	it("shows confirmation prompt when --force is used without -y", async () => {
		ftpCmdMocks.isSet = true;
		forceInteractiveTestEnv();
		// The config is loaded before the confirmation now, so an unloadable
		// workspace fails before asking rather than after.
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
