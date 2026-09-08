import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "./theme-api-command-test-mocks";
import {
	type MockInstance,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ThemeApiClient } from "../../theme-api-client";
import { jsonContentHash } from "../../theme-api-diff";
import { ThemeApiError } from "../../theme-api-error";
import { ThemeApiDiffCommand } from "../theme-api-diff";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

const readdirpMocks = vi.hoisted(() => ({
	readdirpPromise: vi.fn(),
}));

vi.mock("readdirp", () => ({
	readdirpPromise: readdirpMocks.readdirpPromise,
}));

const cwd = path.resolve("./");

function md5(content: string): string {
	return crypto.createHash("md5").update(content, "utf8").digest("hex");
}

function completeConfig(): { success: true; config: Record<string, unknown> } {
	return {
		success: true,
		config: { publicApiToken: "t", storeId: "1", themeId: "9" },
	};
}

function runDiff(tail: string[]): Promise<void> {
	const program = programWithThemeCommand((c) => {
		new ThemeApiDiffCommand().Bind(c);
	});
	return parseWithTail(program, ["theme", "diff", ...tail]);
}

function writtenText(spy: StdoutWriteSpy): string {
	return spy.mock.calls.map((c) => String(c[0])).join("");
}

describe("ThemeApiDiffCommand", () => {
	let stdoutSpy: StdoutWriteSpy;
	/** Assigned by the tests that need it; undone in `afterEach`. */
	let readFileSpy: MockInstance | undefined;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		readdirpMocks.readdirpPromise.mockReset().mockResolvedValue([]);
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
	});

	afterEach(() => {
		// Restored one by one on purpose: `vi.restoreAllMocks()` would also clear the
		// `vi.mock` factory implementations in `theme-api-command-test-mocks`, leaving
		// `CliLogger` and `ThemeApiClient` as empty stubs for every later test.
		stdoutSpy.mockRestore();
		readFileSpy?.mockRestore();
		readFileSpy = undefined;
	});

	it("errors when TryLoadApiConfig fails and never calls the API", async () => {
		await runDiff([]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
		expect(themeApiCmdMocks.getFileHashes).not.toHaveBeenCalled();
	});

	it("errors when the theme id cannot be resolved", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		await runDiff([]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("reports an in-sync theme", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		await runDiff([]);
		expect(writtenText(stdoutSpy)).toContain(
			"No differences — the theme is in sync.",
		);
	});

	it("never uploads anything", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/old.tpl": "abc" },
		});
		await runDiff([]);
		expect(themeApiCmdMocks.batchUpdateFiles).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.upsertFile).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.deleteFile).not.toHaveBeenCalled();
	});

	it("classifies added, modified and deleted files in human output", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: {
				"sections/header.tpl": "oldhash",
				"snippets/legacy.tpl": "abc",
			},
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local content", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
			{ fullPath: path.join(cwd, "sections", "hero.tpl") },
		]);

		await runDiff([]);

		const output = writtenText(stdoutSpy);
		expect(output).toContain("Added (1)");
		expect(output).toContain("sections/hero.tpl");
		expect(output).toContain("Modified (1)");
		expect(output).toContain("sections/header.tpl");
		expect(output).toContain("Deleted (1)");
		expect(output).toContain("snippets/legacy.tpl");
		// No remote content is needed without --detailed.
		expect(themeApiCmdMocks.getFile).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.getFiles).not.toHaveBeenCalled();
	});

	it("prints JSON with --json and keeps stdout JSON-only", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/header.tpl": "oldhash" },
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local content", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
		]);

		await runDiff(["--json"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(parsed.theme_id).toBe("9");
		expect(parsed.forked).toBe(true);
		expect(parsed.detailed).toBe(false);
		expect(parsed.in_sync).toBe(false);
		expect(parsed.summary).toMatchObject({
			added: 0,
			modified: 1,
			deleted: 0,
			unchanged: 0,
		});
		expect(parsed.modified).toEqual([
			{ path: "sections/header.tpl", format: "text" },
		]);
		// JSON mode must not narrate progress on stdout.
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("keeps stdout parseable with --json -v", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/header.tpl": "oldhash" },
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local content", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
		]);

		await runDiff(["--json", "-v"]);

		expect(() => JSON.parse(writtenText(stdoutSpy))).not.toThrow();
		// The client logs verbose HTTP lines through `console.log`, so `-v` has to
		// stay off in JSON mode or the payload stops parsing.
		const clientOptions = vi.mocked(ThemeApiClient).mock.calls.at(-1)?.[0];
		expect(clientOptions).toMatchObject({ verbose: false });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("includes unified patches with --detailed --json", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: {
				"sections/header.tpl": "oldhash",
				"snippets/legacy.tpl": "abc",
			},
		});
		themeApiCmdMocks.getFile.mockImplementation(
			async (_themeId: string, filePath: string) => ({
				path: filePath,
				format: "text",
				content:
					filePath === "sections/header.tpl"
						? "line one\nline two\n"
						: "gone\n",
			}),
		);
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("line one\nline TWO\n", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
			{ fullPath: path.join(cwd, "sections", "hero.tpl") },
		]);

		await runDiff(["--json", "--detailed"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(parsed.detailed).toBe(true);
		expect(parsed.modified[0]).toMatchObject({
			path: "sections/header.tpl",
			lines_added: 1,
			lines_removed: 1,
			truncated: false,
			note: null,
		});
		expect(parsed.modified[0].patch).toContain(
			"--- remote/sections/header.tpl",
		);
		expect(parsed.modified[0].patch).toContain("-line two");
		expect(parsed.modified[0].patch).toContain("+line TWO");
		expect(parsed.added[0].patch).toContain("+++ local/sections/hero.tpl");
		expect(parsed.deleted[0]).toMatchObject({
			path: "snippets/legacy.tpl",
			lines: 1,
		});
		expect(parsed.deleted[0].patch).toContain("-gone");
	});

	it("falls back to paginated getFiles when the single-file endpoint is unsupported", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/header.tpl": "oldhash" },
		});
		themeApiCmdMocks.getFile.mockRejectedValue(
			new ThemeApiError({
				operation: "GET theme file sections/header.tpl",
				status: 405,
				code: null,
				apiMessage: "Method Not Allowed",
				body: null,
			}),
		);
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [
				{
					path: "sections/header.tpl",
					format: "text",
					content: "remote line\n",
				},
			],
			total: 1,
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local line\n", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
		]);

		await runDiff(["--json", "--detailed"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalled();
		expect(parsed.modified[0].patch).toContain("-remote line");
		expect(parsed.modified[0].patch).toContain("+local line");
	});

	it("marks files whose remote content cannot be fetched", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/header.tpl": "oldhash" },
		});
		themeApiCmdMocks.getFile.mockRejectedValue(new Error("HTTP 500"));
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local line\n", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
		]);

		await runDiff(["--json", "--detailed"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(parsed.modified[0].note).toBe("content_unavailable: HTTP 500");
		expect(parsed.modified[0].patch).toBeNull();
	});

	it("does not report JSON files that only differ in formatting", async () => {
		const jsonObj = { greeting: "Hello", count: 42 };
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			// The remote keeps the PHP-serialized hash while the local file is
			// pretty-printed, so only the semantic comparison can match.
			hashes: { "config/settings.json": jsonContentHash(jsonObj) },
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(
				Buffer.from(`${JSON.stringify(jsonObj, null, 2)}\n`, "utf8"),
			);
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "config", "settings.json") },
		]);

		await runDiff(["--json"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(parsed.in_sync).toBe(true);
		expect(parsed.summary.unchanged).toBe(1);
	});

	it("reports theme-code changes that push would skip when not forked", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: false });
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: { "sections/header.tpl": md5("remote content") },
		});
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("local content", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "header.tpl") },
		]);

		await runDiff(["--json"]);

		const parsed = JSON.parse(writtenText(stdoutSpy));
		expect(parsed.forked).toBe(false);
		expect(parsed.skipped_not_forked).toEqual(["sections/header.tpl"]);
		expect(parsed.summary.modified).toBe(0);
	});

	it("wraps API failures in a friendly message", async () => {
		themeApiCmdMocks.tryLoadResult = completeConfig();
		themeApiCmdMocks.getFileHashes.mockRejectedValue(new Error("HTTP 500"));
		await runDiff([]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Failed to fetch remote data: HTTP 500",
		);
	});
});
