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
