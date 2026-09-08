import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiClient } from "./theme-api-client";
import { ThemeApiError } from "./theme-api-error";

type FetchInit = RequestInit & { headers?: HeadersInit };

function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function buildClient(): ThemeApiClient {
	return new ThemeApiClient({
		apiBaseUrl: "https://api.example.com",
		publicApiToken: "token-xyz",
		storeId: "42",
	});
}

describe("ThemeApiClient.requestJson", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the parsed body on a successful response", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, { installations: [{ id: 1 }] }),
		);
		const client = buildClient();

		const body = await client.listInstallations();

		expect(body).toEqual({ installations: [{ id: 1 }] });
		expect(fetchMock).toHaveBeenCalledOnce();
		const [calledUrl] = fetchMock.mock.calls[0] as [string, FetchInit];
		expect(calledUrl).toBe("https://api.example.com/v1/42/theme-installations");
	});

	it("throws a ThemeApiError on a non-ok response, populating all fields", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(409, {
				message: "The store already has the maximum number of installations.",
				code: "INSTALLATION_LIMIT_EXCEEDED",
				status: 409,
			}),
		);
		const client = buildClient();

		await expect(
			client.createInstallation({ theme_code: "x", title: "y" }),
		).rejects.toMatchObject({
			name: "ThemeApiError",
			status: 409,
			code: "INSTALLATION_LIMIT_EXCEEDED",
			operation: "Create installation",
			apiMessage: "The store already has the maximum number of installations.",
		});
	});

	it("renders the CLI hint for codes present in the hints map", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(409, {
				message: "The installation is already in a forked state.",
				code: "INSTALLATION_ALREADY_FORKED",
				status: 409,
			}),
		);
		const client = buildClient();

		try {
			await client.forkInstallation("777");
			throw new Error("expected forkInstallation to reject");
		} catch (err) {
			expect(err).toBeInstanceOf(ThemeApiError);
			expect((err as ThemeApiError).message).toMatch(
				/This installation is already forked./is,
			);
		}
	});

	it("falls back to the API message when the code has no CLI hint", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(404, {
				message: "theme_code does not match any known theme.",
				code: "INVALID_THEME_CODE",
				status: 404,
			}),
		);
		const client = buildClient();

		await expect(
			client.createInstallation({ theme_code: "missing", title: "y" }),
		).rejects.toThrow(
			"Create installation failed (HTTP 404): theme_code does not match any known theme.",
		);
	});

	it("posts the target version to …/update, omitting the title when not given", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 11 }));
		const client = buildClient();

		await expect(client.updateInstallation("10", "2")).resolves.toEqual({
			id: 11,
		});
		const [calledUrl, init] = fetchMock.mock.calls[0] as [string, FetchInit];
		expect(calledUrl).toBe(
			"https://api.example.com/v1/42/theme-installations/10/update",
		);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({ theme_version: "2" });
	});

	it("includes the title in the …/update body when given", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 11 }));
		const client = buildClient();

		await client.updateInstallation("10", "2.3.1", "My upgrade");

		const [, init] = fetchMock.mock.calls[0] as [string, FetchInit];
		expect(JSON.parse(String(init.body))).toEqual({
			theme_version: "2.3.1",
			title: "My upgrade",
		});
	});

	it("posts to …/update/test and returns the report", async () => {
		const report = {
			baseline_version: "1.0.0",
			target_version: "2.0.0",
			conflicts: 1,
			conflicting_files: ["sections/hero.tpl"],
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(200, report));
		const client = buildClient();

		await expect(client.testUpdateInstallation("10", "2.0.0")).resolves.toEqual(
			report,
		);
		const [calledUrl, init] = fetchMock.mock.calls[0] as [string, FetchInit];
		expect(calledUrl).toBe(
			"https://api.example.com/v1/42/theme-installations/10/update/test",
		);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({ theme_version: "2.0.0" });
	});

	it("never retries …/update, even on a retryable status", async () => {
		// Each call creates a theme. A retry after a lost response leaves the store
		// with two, and the second one eats an installation slot — so a 503 is
		// reported rather than re-sent.
		fetchMock.mockResolvedValue(jsonResponse(503, { message: "unavailable" }));
		const client = buildClient();

		await expect(client.updateInstallation("10", "2.0.0")).rejects.toThrow(
			ThemeApiError,
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("does not retry …/update on a lost response (fetch timeout)", async () => {
		// The dangerous case: the API may have created the theme and only the
		// response went missing, which is indistinguishable from never arriving.
		fetchMock.mockRejectedValue(
			new DOMException("The operation was aborted.", "AbortError"),
		);
		const client = buildClient();

		await expect(client.updateInstallation("10", "2.0.0")).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("still retries the read-only …/update/test on a retryable status", async () => {
		const report = {
			baseline_version: "1.0.0",
			target_version: "2.0.0",
			conflicts: 0,
			conflicting_files: [],
		};
		fetchMock
			.mockResolvedValueOnce(jsonResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(jsonResponse(200, report));
		const client = buildClient();

		await expect(client.testUpdateInstallation("10", "2.0.0")).resolves.toEqual(
			report,
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("uses the API message when the body has no code (e.g. UPSTREAM_ERROR without code)", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(502, { message: "Upstream gateway timed out." }),
		);
		const client = buildClient();

		await expect(client.getInstallation("1")).rejects.toMatchObject({
			status: 502,
			code: null,
			apiMessage: "Upstream gateway timed out.",
			message:
				"Get installation failed (HTTP 502): Upstream gateway timed out.",
		});
	});

	it("includes the operation label in the formatted error message", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(422, {
				message: "Only sectionable themes have managed files.",
				code: "THEME_NOT_SECTIONABLE",
				status: 422,
			}),
		);
		const client = buildClient();

		await expect(client.getFiles("123")).rejects.toMatchObject({
			operation: "GET theme files",
			status: 422,
			code: "THEME_NOT_SECTIONABLE",
		});
	});
});

describe("ThemeApiClient.getFile", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("encodes each path segment and returns the parsed body", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, { path: "sections/my header.tpl", format: "text" }),
		);
		const client = buildClient();

		await expect(
			client.getFile("1", "sections/my header.tpl"),
		).resolves.toEqual({ path: "sections/my header.tpl", format: "text" });
		const [calledUrl] = fetchMock.mock.calls[0] as [string, FetchInit];
		expect(calledUrl).toBe(
			"https://api.example.com/v1/42/theme-installations/1/files/sections/my%20header.tpl",
		);
	});

	it("throws ThemeApiError with the path in the operation label", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(405, { message: "Method Not Allowed", status: 405 }),
		);
		const client = buildClient();

		await expect(
			client.getFile("1", "sections/header.tpl"),
		).rejects.toMatchObject({
			name: "ThemeApiError",
			operation: "GET theme file sections/header.tpl",
			status: 405,
		});
	});
});

describe("ThemeApiClient.deleteFile", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("resolves with the parsed body on a successful delete", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
		const client = buildClient();

		await expect(client.deleteFile("1", "snippets/foo.tpl")).resolves.toEqual({
			ok: true,
		});
	});

	it("throws ThemeApiError on 404 (callers decide if NOT_FOUND is a no-op)", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(404, {
				message: "No file exists at the given path.",
				code: "NOT_FOUND",
				status: 404,
			}),
		);
		const client = buildClient();

		await expect(
			client.deleteFile("1", "snippets/missing.tpl"),
		).rejects.toMatchObject({
			name: "ThemeApiError",
			status: 404,
			code: "NOT_FOUND",
		});
	});

	it("throws ThemeApiError on non-404 failures with the path in the operation label", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(409, {
				message: "The provided revision_token does not match.",
				code: "REVISION_TOKEN_MISMATCH",
				status: 409,
			}),
		);
		const client = buildClient();

		await expect(
			client.deleteFile("1", "snippets/foo.tpl"),
		).rejects.toMatchObject({
			name: "ThemeApiError",
			operation: "DELETE theme file snippets/foo.tpl",
			status: 409,
			code: "REVISION_TOKEN_MISMATCH",
		});
	});
});
