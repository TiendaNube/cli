import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "./theme-api-command-test-mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiPushCommand } from "../theme-api-push";
import { parseWithTail, programWithThemeCommand } from "./helpers";
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

function md5(content: string): string {
	return crypto.createHash("md5").update(content, "utf8").digest("hex");
}

// Mirrors phpJsonSerialize in theme-api-push.ts
function phpMd5(content: unknown): string {
	const s = JSON.stringify(content)
		.replace(/\//g, "\\/")
		.replace(
			/[\u0080-\uffff]/g,
			(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
	return crypto.createHash("md5").update(s).digest("hex");
}

describe("ThemeApiPushCommand", () => {
	beforeEach(() => {
		resetThemeApiCmdMocks();
		readdirpMocks.readdirpPromise.mockReset().mockResolvedValue([]);
	});

	it("errors when TryLoadApiConfig fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiPushCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "push", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when installation id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiPushCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "push", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("resolves theme via --published and pushes against it", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 777, is_productive: true },
			],
		});
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
		themeApiCmdMocks.batchUpdateFiles.mockResolvedValue({});
		readdirpMocks.readdirpPromise.mockResolvedValue([]);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPushCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "push", "--published", "-y"]);
		expect(themeApiCmdMocks.getInstallation).toHaveBeenCalledWith("777");
		expect(themeApiCmdMocks.batchUpdateFiles).toHaveBeenCalledWith(
			"777",
			[],
			[],
		);
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
		themeApiCmdMocks.batchUpdateFiles.mockResolvedValue({});
		const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const program = programWithThemeCommand((c) => {
			new ThemeApiPushCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"push",
			"--installation-id",
			"77",
			"-y",
		]);
		expect(themeApiCmdMocks.getInstallation).toHaveBeenCalledWith("77");
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
		stderrSpy.mockRestore();
	});

	it("returns when user declines push confirm", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1", themeId: "9" },
		};
		themeApiCmdMocks.confirm.mockResolvedValueOnce(false);
		const program = programWithThemeCommand((c) => {
			new ThemeApiPushCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "push"]);
		expect(themeApiCmdMocks.getInstallation).not.toHaveBeenCalled();
	});

	describe("sync behavior", () => {
		const cwd = path.resolve("./");

		beforeEach(() => {
			themeApiCmdMocks.tryLoadResult = {
				success: true,
				config: { publicApiToken: "t", storeId: "1", themeId: "9" },
			};
			themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
			themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
			themeApiCmdMocks.batchUpdateFiles.mockResolvedValue({});
		});

		it("calls batchUpdateFiles with empty arrays when no local or remote files", async () => {
			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			expect(themeApiCmdMocks.batchUpdateFiles).toHaveBeenCalledWith(
				"9",
				[],
				[],
			);
		});

		it("deletes remote-only files that no longer exist locally", async () => {
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "sections/old.tpl": "abc" },
			});
			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, , toDelete] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			expect(toDelete).toContain("sections/old.tpl");
		});

		it("never deletes manifest.json even if remote-only", async () => {
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "manifest.json": "abc" },
			});
			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, , toDelete] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			expect(toDelete).not.toContain("manifest.json");
		});

		describe("non-forked installation behavior", () => {
			beforeEach(() => {
				themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: false });
			});

			it("counts non-forked unchanged files in unchanged total, not as skipped", async () => {
				const content = "theme code content";
				const hash = md5(content);
				// sections/ is theme code — not pushable when not forked
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: { "sections/header.tpl": hash },
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(Buffer.from(content, "utf8"));
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "header.tpl") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/unchanged: 1/);
				expect(summary).not.toMatch(/skipped/);
				// Must not appear as a "Skipped (not forked, but has changes)" line
				expect(
					logs.some((l) => l.includes("not forked, but has changes")),
				).toBe(false);

				readFileSpy.mockRestore();
			});

			it("logs skipped files with changes and includes them in skipped counter", async () => {
				// sections/ is theme code — not pushable when not forked
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: { "sections/header.tpl": "oldhash" },
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(Buffer.from("new content", "utf8"));
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "header.tpl") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				expect(
					logs.some((l) =>
						l.includes(
							"Skipped (not forked, but has changes): sections/header.tpl",
						),
					),
				).toBe(true);
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/skipped \(not forked\): 1/);

				readFileSpy.mockRestore();
			});

			it("treats non-forked local files absent from remote as unchanged (cannot compare)", async () => {
				// File exists locally but NOT in the remote hash map — we have no basis to
				// say it was modified, so count as unchanged rather than alarming the user.
				// This handles theme code files whose hashes the backend does not expose.
				themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(Buffer.from("new file content", "utf8"));
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "new.tpl") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				expect(
					logs.some((l) => l.includes("not forked, but has changes")),
				).toBe(false);
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/unchanged: 1/);
				expect(summary).not.toMatch(/skipped/);

				readFileSpy.mockRestore();
			});

			it("unchanged counter sums forked-allowed unchanged files and non-forked unchanged files", async () => {
				const content = "same";
				const hash = md5(content);
				// templates/ is pushable when not forked, sections/ is not
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: {
						"templates/home.tpl": hash,
						"sections/header.tpl": hash,
					},
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(Buffer.from(content, "utf8"));
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "templates", "home.tpl") },
					{ fullPath: path.join(cwd, "sections", "header.tpl") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/unchanged: 2/);
				expect(summary).not.toMatch(/skipped/);

				readFileSpy.mockRestore();
			});

			it("skips unchanged non-forked JSON files using raw MD5, not PHP hash", async () => {
				// When the remote hash equals md5(rawBytes), the file is unchanged.
				const rawContent = JSON.stringify({
					label: "Búsqueda",
					url: "http://x.com/p",
				});
				const rawBytes = Buffer.from(rawContent, "utf8");
				const rawHash = md5(rawContent);
				// sections/ is not pushable when not forked
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: { "sections/data.json": rawHash },
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(rawBytes);
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "data.json") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/unchanged: 1/);
				expect(summary).not.toMatch(/skipped/);

				readFileSpy.mockRestore();
			});

			it("detects non-forked JSON files as skipped when neither raw MD5 nor PHP hash matches remote", async () => {
				const rawBytes = Buffer.from('{"key":"new-value"}', "utf8");
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: { "sections/data.json": "completely-different-hash" },
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(rawBytes);
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "data.json") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				expect(
					logs.some((l) =>
						l.includes(
							"Skipped (not forked, but has changes): sections/data.json",
						),
					),
				).toBe(true);
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/skipped \(not forked\): 1/);

				readFileSpy.mockRestore();
			});

			it("counts non-forked JSON as unchanged when remote hash matches PHP-compatible hash", async () => {
				// When a non-forked file was previously uploaded via CLI its hash is
				// stored as phpJsonSerialize(content) by the backend. If raw MD5
				// mismatches but the PHP hash matches, the file is unchanged.
				const content = { label: "Búsqueda", url: "http://x.com/p" };
				const rawBytes = Buffer.from(JSON.stringify(content), "utf8");
				themeApiCmdMocks.getFileHashes.mockResolvedValue({
					hashes: { "sections/data.json": phpMd5(content) },
				});
				const readFileSpy = vi
					.spyOn(fs, "readFileSync")
					.mockReturnValue(rawBytes);
				readdirpMocks.readdirpPromise.mockResolvedValue([
					{ fullPath: path.join(cwd, "sections", "data.json") },
				]);

				const program = programWithThemeCommand((c) => {
					new ThemeApiPushCommand().Bind(c);
				});
				await parseWithTail(program, ["theme", "push", "-y"]);

				const logs: string[] = (
					themeApiCmdMocks.log.mock.calls as string[][]
				).flat();
				expect(
					logs.some((l) => l.includes("not forked, but has changes")),
				).toBe(false);
				const summary = logs.find((l) => l.includes("Sync completed"));
				expect(summary).toMatch(/unchanged: 1/);
				expect(summary).not.toMatch(/skipped/);

				readFileSpy.mockRestore();
			});
		});

		it("skips remote-only files outside fork-allowed paths when not forked", async () => {
			themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: false });
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: {
					"sections/old.tpl": "abc",
					"templates/pages/orphan.json": "def",
				},
			});
			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, , toDelete] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			expect(toDelete).not.toContain("sections/old.tpl");
			expect(toDelete).toContain("templates/pages/orphan.json");
		});

		it("skips unchanged files (same MD5 hash)", async () => {
			const content = "unchanged content";
			const hash = md5(content);
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "sections/header.tpl": hash },
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from(content, "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "sections", "header.tpl") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			const paths = (toUpsert as { path: string }[]).map((f) => f.path);
			expect(paths).not.toContain("sections/header.tpl");

			const logs: string[] = (
				themeApiCmdMocks.log.mock.calls as string[][]
			).flat();
			const syncing = logs.find((l) => l.includes("Syncing:"));
			expect(syncing).toMatch(/unchanged/);

			readFileSpy.mockRestore();
		});

		it("uploads changed files (different MD5 hash)", async () => {
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "sections/header.tpl": "oldhash" },
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from("new content", "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "sections", "header.tpl") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			const paths = (toUpsert as { path: string }[]).map((f) => f.path);
			expect(paths).toContain("sections/header.tpl");

			readFileSpy.mockRestore();
		});

		it("includes new local files (absent from remote) in toUpsert", async () => {
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from("content", "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "sections", "new.tpl") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			expect(toUpsert).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "sections/new.tpl" }),
				]),
			);

			readFileSpy.mockRestore();
		});

		it("shows unchanged count in summary log", async () => {
			const content = "same";
			const hash = md5(content);
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: {
					"sections/a.tpl": hash,
					"sections/b.tpl": hash,
				},
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from(content, "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "sections", "a.tpl") },
				{ fullPath: path.join(cwd, "sections", "b.tpl") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);

			const logs: string[] = (
				themeApiCmdMocks.log.mock.calls as string[][]
			).flat();
			const summary = logs.find((l) => l.includes("Sync completed"));
			expect(summary).toMatch(/unchanged: 2/);

			readFileSpy.mockRestore();
		});

		it("skips unchanged JSON files when remote hash matches PHP serialization", async () => {
			const jsonObj = { greeting: "Hello", count: 42 };
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "config/settings.json": phpMd5(jsonObj) },
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from(JSON.stringify(jsonObj), "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "config", "settings.json") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			const paths = (toUpsert as { path: string }[]).map((f) => f.path);
			expect(paths).not.toContain("config/settings.json");

			readFileSpy.mockRestore();
		});

		it("skips unchanged JSON files with non-ASCII and slash content", async () => {
			const jsonObj = { label: "Búsqueda", url: "http://x.com/p" };
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "translations/es.json": phpMd5(jsonObj) },
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from(JSON.stringify(jsonObj), "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "translations", "es.json") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			const paths = (toUpsert as { path: string }[]).map((f) => f.path);
			expect(paths).not.toContain("translations/es.json");

			readFileSpy.mockRestore();
		});

		it("uploads JSON files when local content differs from remote", async () => {
			themeApiCmdMocks.getFileHashes.mockResolvedValue({
				hashes: { "config/settings.json": phpMd5({ greeting: "Old" }) },
			});
			const readFileSpy = vi
				.spyOn(fs, "readFileSync")
				.mockReturnValue(Buffer.from('{"greeting":"New"}', "utf8"));
			readdirpMocks.readdirpPromise.mockResolvedValue([
				{ fullPath: path.join(cwd, "config", "settings.json") },
			]);

			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			const [, toUpsert] =
				themeApiCmdMocks.batchUpdateFiles.mock.calls[0] ?? [];
			const paths = (toUpsert as { path: string }[]).map((f) => f.path);
			expect(paths).toContain("config/settings.json");

			readFileSpy.mockRestore();
		});

		it("logs sync error when batchUpdateFiles fails", async () => {
			themeApiCmdMocks.batchUpdateFiles.mockRejectedValue(
				new Error("HTTP 500"),
			);
			const program = programWithThemeCommand((c) => {
				new ThemeApiPushCommand().Bind(c);
			});
			await parseWithTail(program, ["theme", "push", "-y"]);
			expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
				"Upload failed: HTTP 500",
			);
			const errorLogs: string[] = (
				themeApiCmdMocks.error.mock.calls as string[][]
			).flat();
			expect(
				errorLogs.some((m) => m.includes("Sync finished with errors")),
			).toBe(true);
		});
	});
});
