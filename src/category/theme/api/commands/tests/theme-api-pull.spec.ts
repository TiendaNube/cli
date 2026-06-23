import fs from "node:fs";
import path from "node:path";
import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_API_PULL_PAGE_SIZE } from "../../theme-api-constants";
import { ThemeApiPullCommand } from "../theme-api-pull";
import {
	type FsReaddirSyncSpy,
	spyFsReaddirSyncMockNames,
} from "./fs-readdir-sync-spy";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import {
	forceInteractiveTestEnv,
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiPullCommand", () => {
	let readdirSpy: FsReaddirSyncSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		readdirSpy = spyFsReaddirSyncMockNames([".nuvem"]);
	});

	afterEach(() => {
		readdirSpy.mockRestore();
	});

	it("errors when TryLoadApiConfig fails", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when installation id missing", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
	});

	it("persists installation id to workspace after successful pull", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: {
				id: "4542075",
				theme: null,
				theme_version: null,
				forked: false,
				revision_token: null,
			},
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"pull",
			"--theme-id",
			"4542075",
			"-y",
		]);
		expect(themeApiCmdMocks.mergeWorkspace).toHaveBeenCalledWith({
			"theme-api": {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		});
		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("accepts deprecated --installation-id and warns on stderr", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: { id: "4542075" },
		});
		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"pull",
			"--installation-id",
			"4542075",
			"-y",
		]);
		const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderrText).toContain("'--installation-id' is deprecated");
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalledWith("4542075", {
			offset: 0,
			limit: THEME_API_PULL_PAGE_SIZE,
		});
		stderrSpy.mockRestore();
		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("cleans non-hidden entries before downloading and preserves dot-hidden entries", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: {
				id: "4542075",
				theme: null,
				theme_version: null,
				forked: false,
				revision_token: null,
			},
		});
		readdirSpy.mockReturnValue([
			"assets",
			"templates",
			"manifest.json",
			".nuvem",
			".git",
		]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);

		const removed = rmSpy.mock.calls.map((call) =>
			path.basename(String(call[0])),
		);
		expect(removed.sort()).toEqual(["assets", "manifest.json", "templates"]);
		expect(removed).not.toContain(".nuvem");
		expect(removed).not.toContain(".git");
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalled();

		rmSpy.mockRestore();
		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("skips confirm and cleanup when workspace has only hidden entries", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: null,
		});
		readdirSpy.mockReturnValue([".nuvem", ".git"]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull"]);

		expect(themeApiCmdMocks.confirm).not.toHaveBeenCalled();
		expect(rmSpy).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalled();

		rmSpy.mockRestore();
		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("aborts without cleaning or downloading when user declines confirm", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		readdirSpy.mockReturnValue(["assets", ".nuvem"]);
		forceInteractiveTestEnv();
		themeApiCmdMocks.confirm.mockResolvedValueOnce(false);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull"]);

		expect(themeApiCmdMocks.confirm).toHaveBeenCalled();
		expect(rmSpy).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.getFiles).not.toHaveBeenCalled();

		rmSpy.mockRestore();
	});

	it("resolves installation via --published and pulls it", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1" },
		};
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 555, is_productive: true },
			],
		});
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: { id: "555" },
		});
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "--published", "-y"]);
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalledWith("555", {
			offset: 0,
			limit: THEME_API_PULL_PAGE_SIZE,
		});

		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("cleans without prompting when -y is set", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		themeApiCmdMocks.getFiles.mockResolvedValue({
			files: [],
			installation: null,
		});
		readdirSpy.mockReturnValue(["assets", ".nuvem"]);
		const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);

		expect(themeApiCmdMocks.confirm).not.toHaveBeenCalled();
		expect(rmSpy).toHaveBeenCalledTimes(1);
		expect(path.basename(String(rmSpy.mock.calls[0][0]))).toBe("assets");
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalled();

		rmSpy.mockRestore();
		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("paginates getFiles until the server's `total` is reached", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		const pageSize = THEME_API_PULL_PAGE_SIZE;
		const total = pageSize * 4;
		const buildPage = (prefix: string) =>
			Array.from({ length: pageSize }, (_, i) => ({
				path: `${prefix}/file-${i}.js`,
				format: "text",
				content: "x",
			}));
		// 4 full pages — only `total` (not a short page) tells us we're done.
		// With 3 remaining offsets and concurrency 2, the worker pool cycles
		// (assigns 2 in parallel, then picks up the 3rd), which proves the
		// total-driven path goes through mapPool.
		themeApiCmdMocks.getFiles
			.mockResolvedValueOnce({
				files: buildPage("p1"),
				installation: { id: "4542075" },
				total,
			})
			.mockResolvedValueOnce({
				files: buildPage("p2"),
				installation: { id: "4542075" },
				total,
			})
			.mockResolvedValueOnce({
				files: buildPage("p3"),
				installation: { id: "4542075" },
				total,
			})
			.mockResolvedValueOnce({
				files: buildPage("p4"),
				installation: { id: "4542075" },
				total,
			});
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);

		expect(themeApiCmdMocks.getFiles).toHaveBeenCalledTimes(4);
		expect(themeApiCmdMocks.getFiles).toHaveBeenNthCalledWith(1, "4542075", {
			offset: 0,
			limit: pageSize,
		});
		expect(themeApiCmdMocks.getFiles).toHaveBeenNthCalledWith(2, "4542075", {
			offset: pageSize,
			limit: pageSize,
		});
		expect(themeApiCmdMocks.getFiles).toHaveBeenNthCalledWith(3, "4542075", {
			offset: pageSize * 2,
			limit: pageSize,
		});
		expect(themeApiCmdMocks.getFiles).toHaveBeenNthCalledWith(4, "4542075", {
			offset: pageSize * 3,
			limit: pageSize,
		});
		// All `total` file writes + manifest.json
		expect(writeSpy).toHaveBeenCalledTimes(total + 1);

		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("dispatches non-first pages in parallel", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		const pageSize = THEME_API_PULL_PAGE_SIZE;
		const total = pageSize * 3;
		const buildPage = (prefix: string) =>
			Array.from({ length: pageSize }, (_, i) => ({
				path: `${prefix}/file-${i}.js`,
				format: "text",
				content: "x",
			}));
		// Page 1 resolves immediately so the loop progresses.
		themeApiCmdMocks.getFiles.mockResolvedValueOnce({
			files: buildPage("p1"),
			installation: { id: "4542075" },
			total,
		});
		// Page 2 returns a pending promise we manually resolve later. If the
		// implementation were sequential, page 3 would never be called until we
		// resolve page 2.
		const page2Deferred = Promise.withResolvers<unknown>();
		themeApiCmdMocks.getFiles.mockReturnValueOnce(page2Deferred.promise);
		themeApiCmdMocks.getFiles.mockResolvedValueOnce({
			files: buildPage("p3"),
			installation: { id: "4542075" },
			total,
		});
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		const pullPromise = parseWithTail(program, ["theme", "pull", "-y"]);

		// Let the event loop drain enough times for the workers to dispatch.
		for (let i = 0; i < 5; i++) {
			await Promise.resolve();
		}

		// Page 3 must have been dispatched even though page 2 hasn't resolved.
		expect(themeApiCmdMocks.getFiles).toHaveBeenCalledTimes(3);

		// Release page 2 and let the pull finish cleanly.
		page2Deferred.resolve({
			files: buildPage("p2"),
			installation: { id: "4542075" },
			total,
		});
		await pullPromise;

		expect(writeSpy).toHaveBeenCalledTimes(total + 1);

		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});

	it("falls back to short-page termination when `total` is absent", async () => {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				themeId: "4542075",
			},
		};
		const pageSize = THEME_API_PULL_PAGE_SIZE;
		const page1 = Array.from({ length: pageSize }, (_, i) => ({
			path: `assets/file-${i}.js`,
			format: "text",
			content: "x",
		}));
		const page2 = [{ path: "assets/last.js", format: "text", content: "x" }];
		themeApiCmdMocks.getFiles
			.mockResolvedValueOnce({
				files: page1,
				installation: { id: "4542075" },
			})
			.mockResolvedValueOnce({
				files: page2,
				installation: { id: "4542075" },
			});
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const program = programWithThemeCommand((c) => {
			new ThemeApiPullCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "pull", "-y"]);

		expect(themeApiCmdMocks.getFiles).toHaveBeenCalledTimes(2);
		// pageSize (full first page) + 1 (short second page) + manifest.json
		expect(writeSpy).toHaveBeenCalledTimes(pageSize + 1 + 1);

		mkdirSpy.mockRestore();
		writeSpy.mockRestore();
	});
});
