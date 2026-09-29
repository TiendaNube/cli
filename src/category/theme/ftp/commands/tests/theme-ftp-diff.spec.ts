import "./theme-ftp-command-test-mocks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeFtpDiffCommand } from "../theme-ftp-diff";
import { parseWithTail, programWithFtpSubcommand } from "./helpers";
import { ftpCmdMocks, resetFtpCmdMocks } from "./theme-ftp-command-test-mocks";

const VALID_CONFIG = {
	success: true as const,
	config: {
		ftp: { ftpServer: "s", ftpUsername: "u", ftpPassword: "p", verbose: false },
		storeUrl: "https://shop.example.com",
	},
};

function run(argv: string[]): Promise<void> {
	const program = programWithFtpSubcommand((c) => {
		new ThemeFtpDiffCommand().Bind(c);
	});
	return parseWithTail(program, argv);
}

describe("ThemeFtpDiffCommand", () => {
	let stdout: string;
	// Only mockRestore is used here, and the full spy type fights the overloaded
	// signature of process.stdout.write.
	let writeSpy: { mockRestore: () => void };
	let workspace: string;
	let originalCwd: string;

	beforeEach(() => {
		resetFtpCmdMocks();
		stdout = "";
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			stdout += String(chunk);
			return true;
		});
		originalCwd = process.cwd();
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-diff-"));
		process.chdir(workspace);
	});

	afterEach(() => {
		writeSpy.mockRestore();
		process.chdir(originalCwd);
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("errors when configuration is not set", async () => {
		await run(["ftp", "diff"]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Store configuration not found. Please run tiendanube theme ftp setup first.",
		);
		expect(ftpCmdMocks.computeDiff).not.toHaveBeenCalled();
	});

	it("keeps stdout to the JSON payload alone", async () => {
		// ComputeDiff logs progress to stdout by default, which would break the
		// JSON payload.
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockImplementation(
			async (_force: boolean, options: { onNotice?: (m: string) => void }) => {
				options?.onNotice?.("Fetching remote files...");
				return {
					success: true,
					toCreate: [],
					toUpdate: [],
					toDelete: [],
					skippedEmpty: [],
					unchangedCount: 4,
				};
			},
		);
		await run(["ftp", "diff", "--json"]);
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(stdout).not.toContain("Fetching remote files");
		expect(ftpCmdMocks.log).not.toHaveBeenCalled();
	});

	it("still narrates progress in human mode", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockImplementation(
			async (_force: boolean, options: { onNotice?: (m: string) => void }) => {
				options?.onNotice?.("Fetching remote files...");
				return {
					success: true,
					toCreate: [],
					toUpdate: [],
					toDelete: [],
					skippedEmpty: [],
					unchangedCount: 0,
				};
			},
		);
		await run(["ftp", "diff"]);
		expect(ftpCmdMocks.log).toHaveBeenCalledWith("Fetching remote files...");
	});

	it("reports workspace-relative paths, never absolute ones", async () => {
		// ComputeDiff returns absolute local paths; emitting them would leak the
		// user's home directory into an agent's context.
		const nested = path.join(workspace, "snippets");
		fs.mkdirSync(nested, { recursive: true });
		const local = path.join(nested, "card.tpl");
		fs.writeFileSync(local, "content", "utf8");
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: true,
			toCreate: [local],
			toUpdate: [],
			toDelete: ["/old/gone.tpl"],
			skippedEmpty: [],
			unchangedCount: 1,
		});
		await run(["ftp", "diff", "--json"]);
		const report = JSON.parse(stdout);
		expect(report.added).toEqual(["snippets/card.tpl"]);
		expect(report.deleted).toEqual(["old/gone.tpl"]);
		expect(stdout).not.toContain(workspace);
		expect(stdout).not.toContain(os.homedir());
	});

	it("lists zero-byte files apart from the uploads", async () => {
		const empty = path.join(workspace, "blank.css");
		const real = path.join(workspace, "real.css");
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: true,
			toCreate: [real],
			toUpdate: [],
			toDelete: [],
			skippedEmpty: [empty],
			unchangedCount: 0,
		});
		await run(["ftp", "diff", "--json"]);
		const report = JSON.parse(stdout);
		expect(report.added).toEqual(["real.css"]);
		expect(report.skippedEmpty).toEqual(["blank.css"]);
	});

	it("passes --force through to the comparison", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		await run(["ftp", "diff", "--force", "--json"]);
		expect(ftpCmdMocks.computeDiff).toHaveBeenCalledWith(
			true,
			expect.anything(),
		);
	});

	it("says what it compared, so unchanged is not read as a guarantee", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		await run(["ftp", "diff"]);
		expect(stdout).toContain("Compared by file size and modification time");
		expect(stdout).toContain("Nothing to push.");
	});

	it("does not call it nothing to push while empty files still differ", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: true,
			toCreate: [],
			toUpdate: [],
			toDelete: [],
			skippedEmpty: [path.join(workspace, "blank.css")],
			unchangedCount: 3,
		});
		await run(["ftp", "diff"]);
		expect(stdout).toContain(
			"Nothing to push, but 1 empty file(s) differ from the remote and will not be uploaded.",
		);
	});

	it("surfaces a failed comparison as an error", async () => {
		ftpCmdMocks.isSet = true;
		ftpCmdMocks.tryLoadResult = VALID_CONFIG;
		ftpCmdMocks.computeDiff.mockResolvedValue({
			success: false,
			errorMessage: "530 Login incorrect",
		});
		await run(["ftp", "diff"]);
		expect(ftpCmdMocks.error).toHaveBeenCalledWith(
			"Diff failed: 530 Login incorrect",
		);
	});
});
