import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeApiClient } from "./theme-api-client";
import { jsonContentHash } from "./theme-api-diff";
import {
	buildThemeDiffPlan,
	computeFileChangeStatus,
} from "./theme-api-diff-plan";

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

function fakeClient(options: {
	forked?: boolean;
	hashes?: Record<string, string>;
}): ThemeApiClient {
	return {
		getInstallation: vi.fn().mockResolvedValue({
			forked: options.forked ?? true,
		}),
		getFileHashes: vi.fn().mockResolvedValue({ hashes: options.hashes ?? {} }),
	} as unknown as ThemeApiClient;
}

function localEntries(...relativePaths: string[]): { fullPath: string }[] {
	return relativePaths.map((rel) => ({
		fullPath: path.join(cwd, ...rel.split("/")),
	}));
}

describe("computeFileChangeStatus", () => {
	it("treats files missing from remote as unchanged (no baseline)", () => {
		expect(
			computeFileChangeStatus("sections/a.tpl", Buffer.from("x"), new Map()),
		).toBe("unchanged");
	});

	it("compares raw bytes first", () => {
		const map = new Map([["sections/a.tpl", md5("x")]]);
		expect(
			computeFileChangeStatus("sections/a.tpl", Buffer.from("x"), map),
		).toBe("unchanged");
		expect(
			computeFileChangeStatus("sections/a.tpl", Buffer.from("y"), map),
		).toBe("changed");
	});

	it("accepts the PHP-serialized hash for JSON files", () => {
		const content = { label: "Búsqueda", url: "http://x.com/p" };
		const map = new Map([["config/a.json", jsonContentHash(content)]]);
		const pretty = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
		expect(computeFileChangeStatus("config/a.json", pretty, map)).toBe(
			"unchanged",
		);
	});

	it("reports invalid JSON as changed", () => {
		const map = new Map([["config/a.json", "somehash"]]);
		expect(
			computeFileChangeStatus("config/a.json", Buffer.from("{not json"), map),
		).toBe("changed");
	});
});

describe("buildThemeDiffPlan", () => {
	beforeEach(() => {
		readdirpMocks.readdirpPromise.mockReset().mockResolvedValue([]);
	});

	afterEach(() => {
		// Restores the per-test `fs.readFileSync` spies. Doing it at the end of each
		// test body leaks them whenever an expectation fails first.
		vi.restoreAllMocks();
	});

	it("classifies create, update, delete and unchanged", async () => {
		const same = "same content";
		readdirpMocks.readdirpPromise.mockResolvedValue(
			localEntries(
				"sections/new.tpl",
				"sections/changed.tpl",
				"sections/same.tpl",
			),
		);
		vi.spyOn(fs, "readFileSync").mockImplementation((file) =>
			String(file).endsWith("same.tpl")
				? Buffer.from(same, "utf8")
				: Buffer.from("local", "utf8"),
		);

		const plan = await buildThemeDiffPlan({
			client: fakeClient({
				hashes: {
					"sections/changed.tpl": "oldhash",
					"sections/same.tpl": md5(same),
					"sections/gone.tpl": "abc",
				},
			}),
			themeId: "9",
			cwd,
		});

		expect(plan.diff.toCreate.map((f) => f.path)).toEqual(["sections/new.tpl"]);
		expect(plan.diff.toUpdate.map((f) => f.path)).toEqual([
			"sections/changed.tpl",
		]);
		expect(plan.diff.toDelete).toEqual(["sections/gone.tpl"]);
		expect(plan.diff.unchanged).toBe(1);
		expect(plan.forked).toBe(true);
	});

	it("excludes manifest.json and custom/ from the comparison", async () => {
		readdirpMocks.readdirpPromise.mockResolvedValue(
			localEntries("manifest.json", "custom/app.js"),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("x", "utf8"));
		const notices: string[] = [];

		const plan = await buildThemeDiffPlan({
			client: fakeClient({
				hashes: { "manifest.json": "abc", "custom/other.js": "def" },
			}),
			themeId: "9",
			cwd,
			onNotice: (message) => notices.push(message),
		});

		expect(plan.diff.toCreate).toEqual([]);
		expect(plan.diff.toDelete).toEqual([]);
		expect(plan.pushUnsupportedCount).toBe(1);
		expect(notices.some((n) => n.includes("Skipping custom/ files"))).toBe(
			true,
		);
	});

	it("reports non-forked theme-code changes as skipped instead of modified", async () => {
		readdirpMocks.readdirpPromise.mockResolvedValue(
			localEntries("sections/header.tpl", "templates/home.tpl"),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("local", "utf8"));

		const plan = await buildThemeDiffPlan({
			client: fakeClient({
				forked: false,
				hashes: {
					"sections/header.tpl": "oldhash",
					"templates/home.tpl": "oldhash",
				},
			}),
			themeId: "9",
			cwd,
		});

		expect(plan.skippedNotForked).toEqual(["sections/header.tpl"]);
		expect(plan.diff.toUpdate.map((f) => f.path)).toEqual([
			"templates/home.tpl",
		]);
	});

	it("counts empty files as read failures", async () => {
		readdirpMocks.readdirpPromise.mockResolvedValue(
			localEntries("sections/empty.tpl"),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(0));
		const errors: string[] = [];

		const plan = await buildThemeDiffPlan({
			client: fakeClient({}),
			themeId: "9",
			cwd,
			onFileError: (message) => errors.push(message),
		});

		expect(plan.readFailCount).toBe(1);
		expect(plan.diff.toCreate).toEqual([]);
		expect(errors).toEqual([
			"  sections/empty.tpl: Empty file (0 bytes), skipped",
		]);
	});

	it("treats every file as changed with force", async () => {
		const content = "same";
		readdirpMocks.readdirpPromise.mockResolvedValue(
			localEntries("sections/same.tpl"),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from(content, "utf8"));

		const plan = await buildThemeDiffPlan({
			client: fakeClient({ hashes: { "sections/same.tpl": md5(content) } }),
			themeId: "9",
			cwd,
			force: true,
		});

		expect(plan.diff.toUpdate.map((f) => f.path)).toEqual([
			"sections/same.tpl",
		]);
		expect(plan.diff.unchanged).toBe(0);
	});

	it("wraps remote fetch failures in a CLI error", async () => {
		const client = {
			getInstallation: vi.fn().mockRejectedValue(new Error("HTTP 500")),
			getFileHashes: vi.fn().mockResolvedValue({ hashes: {} }),
		} as unknown as ThemeApiClient;

		await expect(
			buildThemeDiffPlan({ client, themeId: "9", cwd }),
		).rejects.toThrow("Failed to fetch remote data: HTTP 500");
	});

	it("blames the local scan, not the API, when the traversal fails", async () => {
		readdirpMocks.readdirpPromise.mockRejectedValue(
			new Error("EACCES: permission denied"),
		);

		await expect(
			buildThemeDiffPlan({ client: fakeClient({}), themeId: "9", cwd }),
		).rejects.toThrow(
			"Failed to read local theme files: EACCES: permission denied",
		);
	});
});
