import { describe, expect, it, vi } from "vitest";
import type { ThemeApiClient } from "./theme-api-client";
import { ThemeApiError } from "./theme-api-error";
import {
	fetchAllRemoteFiles,
	fetchRemoteContents,
} from "./theme-api-remote-content";

function apiError(status: number): ThemeApiError {
	return new ThemeApiError({
		operation: "GET theme file x",
		status,
		code: null,
		apiMessage: "boom",
		body: null,
	});
}

describe("fetchAllRemoteFiles", () => {
	it("pages until the reported total is covered", async () => {
		const page = (offset: number): unknown => ({
			installation: { id: 9 },
			files: Array.from({ length: 50 }, (_, i) => ({
				path: `sections/f${offset + i}.tpl`,
				format: "text",
				content: "x",
			})),
			total: 120,
		});
		const getFiles = vi
			.fn()
			.mockImplementation(async (_id: string, opts: { offset: number }) =>
				opts.offset === 100
					? {
							installation: { id: 9 },
							files: [
								{ path: "sections/f100.tpl", format: "text", content: "x" },
							],
							total: 120,
						}
					: page(opts.offset),
			);
		const client = { getFiles } as unknown as ThemeApiClient;

		const { installation, files } = await fetchAllRemoteFiles(client, "9");

		expect(getFiles).toHaveBeenCalledTimes(3);
		expect(files).toHaveLength(101);
		expect(installation).toMatchObject({ id: 9 });
	});

	it("iterates sequentially until a short page when total is absent", async () => {
		const getFiles = vi
			.fn()
			.mockImplementation(async (_id: string, opts: { offset: number }) => ({
				installation: null,
				files:
					opts.offset === 0
						? Array.from({ length: 50 }, (_, i) => ({
								path: `a${i}.tpl`,
								format: "text",
								content: "x",
							}))
						: [{ path: "b.tpl", format: "text", content: "x" }],
			}));
		const client = { getFiles } as unknown as ThemeApiClient;

		const { files } = await fetchAllRemoteFiles(client, "9");

		expect(getFiles).toHaveBeenCalledTimes(2);
		expect(files).toHaveLength(51);
	});
});

describe("fetchRemoteContents", () => {
	it("returns nothing for an empty path list without calling the API", async () => {
		const getFile = vi.fn();
		const client = { getFile } as unknown as ThemeApiClient;

		const result = await fetchRemoteContents(client, "9", []);

		expect(result.files.size).toBe(0);
		expect(getFile).not.toHaveBeenCalled();
	});

	it("fetches each path through the single-file endpoint", async () => {
		const getFile = vi
			.fn()
			.mockImplementation(async (_id: string, filePath: string) => ({
				path: filePath,
				format: "text",
				content: `content of ${filePath}`,
			}));
		const client = { getFile } as unknown as ThemeApiClient;

		const result = await fetchRemoteContents(client, "9", ["a.tpl", "b.tpl"]);

		expect(getFile).toHaveBeenCalledTimes(2);
		expect(result.files.get("b.tpl")?.content).toBe("content of b.tpl");
		expect(result.unavailable.size).toBe(0);
	});

	it("falls back to full pagination when the endpoint is unsupported", async () => {
		const getFile = vi.fn().mockRejectedValue(apiError(405));
		const getFiles = vi.fn().mockResolvedValue({
			installation: null,
			files: [{ path: "a.tpl", format: "text", content: "remote a" }],
			total: 1,
		});
		const client = { getFile, getFiles } as unknown as ThemeApiClient;
		const notices: string[] = [];

		const result = await fetchRemoteContents(
			client,
			"9",
			["a.tpl", "missing.tpl"],
			{ onNotice: (message) => notices.push(message) },
		);

		// The probe is the only single-file attempt before falling back.
		expect(getFile).toHaveBeenCalledTimes(1);
		expect(getFiles).toHaveBeenCalled();
		expect(result.files.get("a.tpl")?.content).toBe("remote a");
		expect(result.unavailable.get("missing.tpl")).toBe(
			"not found in the remote theme",
		);
		expect(notices.some((n) => n.includes("downloading the full theme"))).toBe(
			true,
		);
	});

	it("records per-file failures without falling back", async () => {
		const getFile = vi
			.fn()
			.mockImplementation(async (_id: string, filePath: string) => {
				if (filePath === "b.tpl") {
					throw apiError(500);
				}
				return { path: filePath, format: "text", content: "ok" };
			});
		const getFiles = vi.fn();
		const client = { getFile, getFiles } as unknown as ThemeApiClient;

		const result = await fetchRemoteContents(client, "9", ["a.tpl", "b.tpl"]);

		expect(getFiles).not.toHaveBeenCalled();
		expect(result.files.has("a.tpl")).toBe(true);
		expect(result.unavailable.get("b.tpl")).toContain("HTTP 500");
	});

	it("treats a 404 on the probe as an unsupported endpoint and falls back", async () => {
		const getFile = vi.fn().mockRejectedValue(apiError(404));
		const getFiles = vi.fn().mockResolvedValue({
			installation: null,
			files: [{ path: "a.tpl", format: "text", content: "remote a" }],
			total: 1,
		});
		const client = { getFile, getFiles } as unknown as ThemeApiClient;

		const result = await fetchRemoteContents(client, "9", ["a.tpl"]);

		expect(getFiles).toHaveBeenCalled();
		expect(result.files.get("a.tpl")?.content).toBe("remote a");
	});
});
