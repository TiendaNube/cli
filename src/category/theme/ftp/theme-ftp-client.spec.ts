import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeFtpClient } from "./theme-ftp-client";
import type { ThemeFtpClientConfig } from "./theme-ftp-client-config";

const ftpMocks = vi.hoisted(() => ({
	access: vi.fn(),
	close: vi.fn(),
	uploadFrom: vi.fn(),
	remove: vi.fn(),
	downloadTo: vi.fn(),
	list: vi.fn(),
	lastMod: vi.fn(),
}));

vi.mock("basic-ftp", () => ({
	Client: class MockClient {
		ftp = { verbose: false };
		access = ftpMocks.access;
		close = ftpMocks.close;
		uploadFrom = ftpMocks.uploadFrom;
		remove = ftpMocks.remove;
		downloadTo = ftpMocks.downloadTo;
		list = ftpMocks.list;
		lastMod = ftpMocks.lastMod;
	},
	FileType: { File: 1, Directory: 2, Unknown: 3 },
}));

const readdirMocks = vi.hoisted(() => ({
	readdirpPromise: vi.fn(),
}));

vi.mock("readdirp", () => ({
	readdirpPromise: readdirMocks.readdirpPromise,
}));

vi.mock("../../../cli-logger", () => ({
	CliLogger: class {
		Log = vi.fn();
		Error = vi.fn();
	},
}));

const baseConfig: ThemeFtpClientConfig = {
	ftpServer: "ftp.example.com",
	ftpUsername: "u",
	ftpPassword: "p",
	verbose: false,
};

describe("ThemeFtpClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.uploadFrom.mockResolvedValue(undefined);
		ftpMocks.remove.mockResolvedValue(undefined);
		ftpMocks.downloadTo.mockResolvedValue(undefined);
		ftpMocks.list.mockResolvedValue([]);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		readdirMocks.readdirpPromise.mockResolvedValue([]);
	});

	it("Test succeeds when FTP access succeeds", async () => {
		const client = new ThemeFtpClient(baseConfig);
		const result = await client.Test();
		expect(result.success).toBe(true);
		expect(result.errorMessage).toBe("");
		expect(ftpMocks.access).toHaveBeenCalled();
		expect(ftpMocks.close).toHaveBeenCalled();
	});

	it("Test surfaces Error message when access fails", async () => {
		ftpMocks.access.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		const client = new ThemeFtpClient(baseConfig);
		const result = await client.Test();
		expect(result.success).toBe(false);
		expect(result.errorMessage).toBe("ECONNREFUSED");
	});

	it("Test stringifies non-Error rejection values", async () => {
		ftpMocks.access.mockRejectedValueOnce("offline");
		const client = new ThemeFtpClient(baseConfig);
		const result = await client.Test();
		expect(result.success).toBe(false);
		expect(result.errorMessage).toBe("offline");
	});

	it("Upload maps Windows-style relative paths to POSIX remote paths", async () => {
		const snippetsDir = path.join(process.cwd(), "snippets");
		const filePath = path.join(snippetsDir, "foo.tpl");
		fs.mkdirSync(snippetsDir, { recursive: true });
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValue("snippets\\foo.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(true);
			expect(ftpMocks.uploadFrom).toHaveBeenCalledWith(
				filePath,
				"/snippets/foo.tpl",
			);
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(snippetsDir, { recursive: true, force: true });
		}
	});

	it("Delete maps Windows-style relative paths to POSIX remote paths", async () => {
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValue("templates\\x.tpl");
		const client = new ThemeFtpClient(baseConfig);
		const filePath = path.join(process.cwd(), "templates", "x.tpl");
		const result = await client.Delete(filePath);
		relativeSpy.mockRestore();

		expect(result.success).toBe(true);
		expect(ftpMocks.remove).toHaveBeenCalledWith("/templates/x.tpl");
	});

	it.skipIf(process.platform === "win32")(
		"Delete calls FTP remove for an already-deleted file under symlinked theme root",
		async () => {
			const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-real-"));
			const linkRoot = path.join(
				os.tmpdir(),
				`theme-cli-link-${process.pid}-${Date.now()}`,
			);
			fs.symlinkSync(realRoot, linkRoot, "dir");

			const templatesDir = path.join(realRoot, "templates");
			fs.mkdirSync(templatesDir, { recursive: true });
			const filePath = path.join(templatesDir, "gone.tpl");
			fs.writeFileSync(filePath, "x");
			const canonicalFilePath = fs.realpathSync.native(filePath);
			fs.unlinkSync(filePath);

			const prev = process.cwd();
			process.chdir(linkRoot);
			try {
				const client = new ThemeFtpClient(baseConfig);
				const result = await client.Delete(canonicalFilePath);
				expect(result.success).toBe(true);
				expect(ftpMocks.remove).toHaveBeenCalledWith("/templates/gone.tpl");
			} finally {
				process.chdir(prev);
				fs.unlinkSync(linkRoot);
				fs.rmSync(realRoot, { recursive: true, force: true });
			}
		},
	);

	it("Upload skips excluded paths without calling FTP", async () => {
		const client = new ThemeFtpClient(baseConfig);
		const hiddenFile = path.join(process.cwd(), "src", ".hidden", "x.txt");
		const result = await client.Upload(hiddenFile);
		expect(result.success).toBe(true);
		expect(ftpMocks.access).not.toHaveBeenCalled();
	});

	it("RunFtpCommandWithRetries surfaces errors from the FTP action", async () => {
		ftpMocks.uploadFrom.mockRejectedValueOnce(new Error("upload failed"));
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(false);
			expect(result.errorMessage).toBe("upload failed");
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});

	// delay() is spied to resolve instantly so the backoff does not slow the tests.
	type WithDelay = { delay: () => Promise<void> };

	it("retries a transient transport error and eventually succeeds", async () => {
		ftpMocks.uploadFrom
			.mockRejectedValueOnce(new Error("Premature close"))
			.mockRejectedValueOnce(new Error("Premature close"));
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			vi.spyOn(client as unknown as WithDelay, "delay").mockResolvedValue(
				undefined,
			);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(true);
			expect(ftpMocks.uploadFrom).toHaveBeenCalledTimes(3);
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});

	it("retries a persistent transient error up to the max and then fails", async () => {
		ftpMocks.uploadFrom.mockRejectedValue(new Error("ECONNRESET"));
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			vi.spyOn(client as unknown as WithDelay, "delay").mockResolvedValue(
				undefined,
			);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(false);
			expect(result.errorMessage).toBe("ECONNRESET");
			// FTP_MAX_RETRIES = 3 → three attempts, no fourth.
			expect(ftpMocks.uploadFrom).toHaveBeenCalledTimes(3);
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});

	it("does not retry a non-retryable FTP error and fails on the first attempt", async () => {
		ftpMocks.uploadFrom.mockRejectedValue(
			Object.assign(new Error("550 Permission denied"), { code: 550 }),
		);
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			const delaySpy = vi
				.spyOn(client as unknown as WithDelay, "delay")
				.mockResolvedValue(undefined);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(false);
			expect(ftpMocks.uploadFrom).toHaveBeenCalledTimes(1);
			expect(delaySpy).not.toHaveBeenCalled();
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});

	it("DownloadAll succeeds when remote tree is empty", async () => {
		const client = new ThemeFtpClient(baseConfig);
		const result = await client.DownloadAll();
		expect(result.success).toBe(true);
		expect(ftpMocks.list).toHaveBeenCalled();
	});

	it("Upload pulls server mtime back to local file via MDTM after upload", async () => {
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const serverMtime = new Date(Date.UTC(2026, 4, 8, 14, 20, 41));
		ftpMocks.lastMod.mockResolvedValueOnce(serverMtime);
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(true);
			expect(ftpMocks.lastMod).toHaveBeenCalledWith("/ok.tpl");
			expect(fs.statSync(filePath).mtimeMs).toBe(serverMtime.getTime());
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});

	it("Upload tolerates MDTM failures (server without MDTM support)", async () => {
		ftpMocks.lastMod.mockRejectedValueOnce(new Error("502 not implemented"));
		const filePath = path.join(process.cwd(), "ok.tpl");
		fs.writeFileSync(filePath, "x", "utf8");
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValue("ok.tpl");
		try {
			const client = new ThemeFtpClient(baseConfig);
			const result = await client.Upload(filePath);
			expect(result.success).toBe(true);
		} finally {
			relativeSpy.mockRestore();
			fs.rmSync(filePath, { force: true });
		}
	});
});

describe("ThemeFtpClient needsUpload", () => {
	let tmpDir: string;
	let prev: string;

	beforeEach(() => {
		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.uploadFrom.mockResolvedValue(undefined);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		prev = process.cwd();
	});

	afterEach(() => {
		process.chdir(prev);
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	const setup = (fileContent = "content") => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-needs-upload-"));
		const filePath = path.join(tmpDir, "style.css");
		fs.writeFileSync(filePath, fileContent, "utf8");
		const stat = fs.statSync(filePath);
		process.chdir(tmpDir);
		readdirMocks.readdirpPromise.mockResolvedValue([{ fullPath: filePath }]);
		return { filePath, stat };
	};

	const makeDiff = async (remoteEntry: object) => {
		ftpMocks.list.mockResolvedValue([remoteEntry]);
		const result = await new ThemeFtpClient(baseConfig).ComputeDiff();
		if (!result.success) throw new Error(result.errorMessage);
		return result;
	};

	it("skips upload when local file has size 0, even if remote size differs", async () => {
		const { stat } = setup("");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: 100,
			modifiedAt: new Date(stat.mtimeMs - 5000),
		});
		expect(diff.toUpdate).toHaveLength(0);
		expect(diff.unchangedCount).toBe(1);
	});

	it("marks file for upload when local and remote sizes differ", async () => {
		const { filePath, stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size + 100,
			modifiedAt: new Date(stat.mtimeMs),
		});
		expect(diff.toUpdate).toContain(filePath);
	});

	it("marks file for upload when remote modifiedAt is undefined", async () => {
		const { filePath, stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: undefined,
		});
		expect(diff.toUpdate).toContain(filePath);
	});

	it("skips upload when local is newer than remote by less than 2000ms", async () => {
		const { stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs - 1000),
		});
		expect(diff.toUpdate).toHaveLength(0);
		expect(diff.unchangedCount).toBe(1);
	});

	it("marks file for upload when local is newer than remote by more than 2000ms", async () => {
		const { filePath, stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs - 3000),
		});
		expect(diff.toUpdate).toContain(filePath);
	});

	it("skips upload when remote is newer than local by less than 2000ms", async () => {
		const { stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs + 1000),
		});
		expect(diff.toUpdate).toHaveLength(0);
		expect(diff.unchangedCount).toBe(1);
	});

	it("marks file for upload when remote is newer than local by more than 2000ms", async () => {
		const { filePath, stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs + 3000),
		});
		expect(diff.toUpdate).toContain(filePath);
	});

	it("skips upload when difference is 1999ms (within 2000ms tolerance)", async () => {
		const { stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs - 1999),
		});
		expect(diff.toUpdate).toHaveLength(0);
		expect(diff.unchangedCount).toBe(1);
	});

	it("marks file for upload at 2001ms difference (just past boundary)", async () => {
		const { filePath, stat } = setup("content");
		const diff = await makeDiff({
			type: 1,
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs - 2001),
		});
		expect(diff.toUpdate).toContain(filePath);
	});
});

describe("ThemeFtpClient SyncAll force mode", () => {
	let tmpDir: string;
	let prev: string;

	beforeEach(() => {
		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.uploadFrom.mockResolvedValue(undefined);
		ftpMocks.remove.mockResolvedValue(undefined);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		prev = process.cwd();
	});

	afterEach(() => {
		process.chdir(prev);
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("skips upload of unchanged files in normal mode but uploads them with force=true", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-force-"));
		const filePath = path.join(tmpDir, "style.css");
		fs.writeFileSync(filePath, "body{}", "utf8");
		const stat = fs.statSync(filePath);

		process.chdir(tmpDir);

		const remoteEntry = {
			type: 1, // FileType.File
			name: "style.css",
			size: stat.size,
			modifiedAt: new Date(stat.mtimeMs - 1000),
		};

		ftpMocks.list.mockResolvedValue([remoteEntry]);
		readdirMocks.readdirpPromise.mockResolvedValue([{ fullPath: filePath }]);

		const client = new ThemeFtpClient(baseConfig);

		const normalResult = await client.SyncAll();
		expect(normalResult.success).toBe(true);
		expect(ftpMocks.uploadFrom).not.toHaveBeenCalled();

		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.uploadFrom.mockResolvedValue(undefined);
		ftpMocks.list.mockResolvedValue([remoteEntry]);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		readdirMocks.readdirpPromise.mockResolvedValue([{ fullPath: filePath }]);

		const forceResult = await client.SyncAll(true);
		expect(forceResult.success).toBe(true);
		expect(ftpMocks.uploadFrom).toHaveBeenCalledWith(filePath, "/style.css");
	});

	it("SyncAll copies server mtime to each local file after upload so future diffs match", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-mdtm-"));
		const filePath = path.join(tmpDir, "a.css");
		fs.writeFileSync(filePath, "body{}", "utf8");
		const userEditMtime = new Date(Date.UTC(2026, 4, 8, 12, 30, 45));
		fs.utimesSync(filePath, userEditMtime, userEditMtime);

		process.chdir(tmpDir);

		// Remote missing the file: forces an upload, regardless of mtime tolerance.
		ftpMocks.list.mockResolvedValue([]);
		readdirMocks.readdirpPromise.mockResolvedValue([{ fullPath: filePath }]);
		const serverMtime = new Date(Date.UTC(2026, 4, 8, 14, 20, 41));
		ftpMocks.lastMod.mockResolvedValue(serverMtime);

		const client = new ThemeFtpClient(baseConfig);
		const result = await client.SyncAll();
		expect(result.success).toBe(true);
		expect(ftpMocks.uploadFrom).toHaveBeenCalledWith(filePath, "/a.css");
		expect(ftpMocks.lastMod).toHaveBeenCalledWith("/a.css");
		expect(fs.statSync(filePath).mtimeMs).toBe(serverMtime.getTime());
	});
});

describe("ThemeFtpClient DownloadAll mtime preservation", () => {
	let tmpDir: string;
	let prev: string;

	beforeEach(() => {
		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		prev = process.cwd();
	});

	afterEach(() => {
		process.chdir(prev);
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("sets local mtime from remote modifiedAt after each download", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-pull-mtime-"));
		process.chdir(tmpDir);

		const remoteMtime = new Date(Date.UTC(2025, 11, 10, 8, 0, 0));
		ftpMocks.list.mockResolvedValue([
			{ type: 1, name: "a.css", size: 7, modifiedAt: remoteMtime },
		]);
		// Mocked downloadTo writes the file so we can read its mtime back.
		ftpMocks.downloadTo.mockImplementation(
			async (localPath: string, _remote: string) => {
				fs.writeFileSync(localPath, "body{}", "utf8");
			},
		);

		const client = new ThemeFtpClient(baseConfig);
		const result = await client.DownloadAll();
		expect(result.success).toBe(true);

		const stat = fs.statSync(path.join(tmpDir, "a.css"));
		expect(stat.mtimeMs).toBe(remoteMtime.getTime());
	});

	it("tolerates utimes failures and does not fail the download", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-pull-utimes-"));
		process.chdir(tmpDir);

		ftpMocks.list.mockResolvedValue([
			{ type: 1, name: "a.css", size: 7, modifiedAt: new Date() },
		]);
		// Don't actually write the file: utimes will fail with ENOENT, which we must swallow.
		ftpMocks.downloadTo.mockResolvedValue(undefined);

		const client = new ThemeFtpClient(baseConfig);
		const result = await client.DownloadAll();
		expect(result.success).toBe(true);
	});
});

describe("ThemeFtpClient delete tolerance", () => {
	let tmpDir: string;
	let prev: string;

	beforeEach(() => {
		vi.clearAllMocks();
		ftpMocks.access.mockResolvedValue(undefined);
		ftpMocks.lastMod.mockResolvedValue(new Date(0));
		prev = process.cwd();
	});

	afterEach(() => {
		process.chdir(prev);
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// Empty local tree + one remote file ⇒ ComputeDiff schedules that file for deletion.
	const setupDeleteOnly = () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-ftp-delete-"));
		process.chdir(tmpDir);
		ftpMocks.list.mockResolvedValue([
			{ type: 1, name: "gone.css", size: 5, modifiedAt: new Date() },
		]);
		readdirMocks.readdirpPromise.mockResolvedValue([]);
	};

	it("treats an already-removed file (FTP 450) as a successful delete", async () => {
		setupDeleteOnly();
		ftpMocks.remove.mockRejectedValue(
			Object.assign(new Error("450 No permission to delete"), { code: 450 }),
		);
		const result = await new ThemeFtpClient(baseConfig).SyncAll();
		expect(result.success).toBe(true);
		expect(ftpMocks.remove).toHaveBeenCalledWith("/gone.css");
	});

	it("treats a missing file (FTP 550) as a successful delete", async () => {
		setupDeleteOnly();
		ftpMocks.remove.mockRejectedValue(
			Object.assign(new Error("550 No such file"), { code: 550 }),
		);
		const result = await new ThemeFtpClient(baseConfig).SyncAll();
		expect(result.success).toBe(true);
	});

	it("fails when delete returns a non-ignorable error", async () => {
		setupDeleteOnly();
		ftpMocks.remove.mockRejectedValue(
			Object.assign(new Error("553 unexpected"), { code: 553 }),
		);
		const result = await new ThemeFtpClient(baseConfig).SyncAll();
		expect(result.success).toBe(false);
	});
});
