import "./auth-command-test-mocks";
import {
	type MockInstance,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	DEFAULT_PUBLIC_API_BASE_URL,
	DEFAULT_THEME_AUTHORIZE_URL,
} from "../../../theme/api/theme-api-constants";
import type { Identity } from "../../domain/auth-credentials-types";
import { AuthLoginCommand } from "../auth-login";
import {
	type AuthFixture,
	authCmdMocks,
	createAuthFixture,
	forceInteractiveTestEnv,
	parseWithTail,
	programWith,
	readNuvem,
	resetAuthCmdMocks,
} from "./auth-command-test-mocks";

function base64Payload(storeId: number, accessToken: string): string {
	return Buffer.from(
		JSON.stringify({ store_id: storeId, access_token: accessToken }),
		"utf8",
	).toString("base64");
}

function storeResponse(body: Record<string, unknown>, status = 200): Response {
	return {
		ok: status < 400,
		status,
		text: async () => JSON.stringify(body),
	} as Response;
}

function makeFakePuppeteer() {
	const page = {
		setDefaultTimeout: vi.fn(),
		setDefaultNavigationTimeout: vi.fn(),
		goto: vi.fn().mockResolvedValue(undefined),
	};
	const browser = {
		pages: vi.fn().mockResolvedValue([page]),
		close: vi.fn().mockResolvedValue(undefined),
	};
	return { page, browser };
}

const ACME = {
	url_with_protocol: "https://acme.lojavirtualnuvem.com.br",
	original_domain: "acme.lojavirtualnuvem.com.br",
};

describe("AuthLoginCommand", () => {
	let fixture: AuthFixture;
	let fetchSpy: MockInstance<typeof globalThis.fetch>;
	let fakePuppeteer: ReturnType<typeof makeFakePuppeteer>;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
		fakePuppeteer = makeFakePuppeteer();
		authCmdMocks.puppeteerLaunch.mockResolvedValue(fakePuppeteer.browser);
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		fixture.cleanup();
	});

	function program(binding?: { name: string; deprecatedFor: string }) {
		return programWith(binding ? "theme" : "auth", (c) => {
			new AuthLoginCommand(fixture.store, fixture.workspace).Bind(c, binding);
		});
	}

	it("signs in through the browser, stores the credential under a derived alias and links the folder", async () => {
		authCmdMocks.password.mockResolvedValueOnce(
			base64Payload(9_080_701, "my-access-token"),
		);
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), ["auth", "login"]);

		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "latam");
		expect(fakePuppeteer.page.goto).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
		expect(authCmdMocks.password).toHaveBeenCalledWith("Paste your token:");
		expect(fakePuppeteer.browser.close).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith(
			`${DEFAULT_PUBLIC_API_BASE_URL}/2025-03/9080701/store`,
			expect.objectContaining({ method: "GET" }),
		);
		expect(authCmdMocks.listInstallations).toHaveBeenCalledTimes(1);
		expect(authCmdMocks.error).not.toHaveBeenCalled();

		expect(fixture.store.get("acme")).toMatchObject({
			type: "store",
			data: {
				storeId: "9080701",
				storeUrl: "https://acme.lojavirtualnuvem.com.br",
			},
			tokens: { api: { accessToken: "my-access-token" } },
		});
		expect(readNuvem(fixture.workspaceFile)).toEqual({
			alias: "acme",
		});
	});

	it("opens the authorize page with region=br when the CLI is nuvemshop", async () => {
		authCmdMocks.bin = "nuvemshop";
		await parseWithTail(program(), ["auth", "login"]);
		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "br");
		expect(fakePuppeteer.page.goto).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
	});

	it("skips the browser with --token and honours --alias as the name", async () => {
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));
		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "flag-token"),
			"--alias",
			"my-shop",
		]);
		expect(authCmdMocks.puppeteerLaunch).not.toHaveBeenCalled();
		expect(authCmdMocks.password).not.toHaveBeenCalled();
		expect(fixture.store.get("my-shop")?.tokens.api?.accessToken).toBe(
			"flag-token",
		);
	});

	it("re-login of a stored store keeps its alias and refreshes only the token", async () => {
		const existing: Identity = {
			alias: "kept",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: { storeId: "1", storeUrl: "https://acme.lojavirtualnuvem.com.br" },
			tokens: {
				api: { accessToken: "old" },
				ftp: { server: "s", username: "u", password: "p" },
			},
		};
		fixture.store.put(existing);
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "new"),
		]);

		expect(fixture.store.list()).toHaveLength(1);
		expect(fixture.store.get("kept")).toMatchObject({
			createdAt: existing.createdAt,
			tokens: { api: { accessToken: "new" }, ftp: existing.tokens.ftp },
		});
		expect(authCmdMocks.input).not.toHaveBeenCalled();
	});

	it("suffixes the derived alias when another store already uses it", async () => {
		fixture.store.put({
			alias: "acme",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: { storeId: "2", storeUrl: "https://acme.mitiendanube.com" },
			tokens: { api: { accessToken: "other" } },
		});
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
		]);

		expect(fixture.store.get("acme-2")?.data.storeId).toBe("1");
		expect(fixture.store.get("acme")?.data.storeId).toBe("2");
	});

	it("refuses an --alias that belongs to another store", async () => {
		fixture.store.put({
			alias: "taken",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: { storeId: "2" },
			tokens: { api: { accessToken: "other" } },
		});
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
			"--alias",
			"taken",
		]);

		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining(
				'The alias "taken" already belongs to another store (#2)',
			),
		);
		expect(fixture.store.get("taken")?.tokens.api?.accessToken).toBe("other");
	});

	it("asks nothing about the alias or the folder, and links it", async () => {
		forceInteractiveTestEnv();
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
		]);

		expect(authCmdMocks.input).not.toHaveBeenCalled();
		expect(authCmdMocks.confirm).not.toHaveBeenCalled();
		expect(fixture.store.get("acme")).toBeDefined();
		expect(readNuvem(fixture.workspaceFile)).toMatchObject({ alias: "acme" });
	});

	it("adds the Public API credential to the FTP-only entry of the same storefront", async () => {
		fixture.store.put({
			alias: "classic",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: { storeUrl: "https://acme.lojavirtualnuvem.com.br" },
			tokens: { ftp: { server: "s", username: "u", password: "p" } },
		});
		forceInteractiveTestEnv();
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
		]);

		expect(authCmdMocks.confirm).not.toHaveBeenCalled();
		expect(fixture.store.list()).toHaveLength(1);
		expect(fixture.store.get("classic")).toMatchObject({
			data: { storeId: "1" },
			tokens: { api: { accessToken: "t" }, ftp: { password: "p" } },
		});
	});

	it("with --no-link stores the credential and leaves the folder's .nuvem alone", async () => {
		fixture.workspace.linkAlias("other");
		const before = readNuvem(fixture.workspaceFile);
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));

		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
			"--no-link",
		]);

		expect(fixture.store.get("acme")).toBeDefined();
		expect(readNuvem(fixture.workspaceFile)).toEqual(before);
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining("auth link --alias acme"),
		);
	});

	it("saves nothing when the API rejects the token", async () => {
		fetchSpy.mockResolvedValueOnce(
			storeResponse({ message: "Forbidden" }, 403),
		);
		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
		]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("did not accept this token (HTTP 403)"),
		);
		expect(fixture.store.list()).toEqual([]);
		expect(readNuvem(fixture.workspaceFile)).toBeNull();
	});

	it("saves nothing when theme access cannot be verified", async () => {
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));
		authCmdMocks.listInstallations.mockRejectedValueOnce(new Error("HTTP 401"));
		await parseWithTail(program(), [
			"auth",
			"login",
			"--token",
			base64Payload(1, "t"),
		]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("could not list this store's themes"),
		);
		expect(fixture.store.list()).toEqual([]);
	});

	it("errors on a malformed token without opening the browser", async () => {
		const bad = Buffer.from("not-json", "utf8").toString("base64");
		await parseWithTail(program(), ["auth", "login", "--token", bad]);
		expect(authCmdMocks.puppeteerLaunch).not.toHaveBeenCalled();
		expect(String(authCmdMocks.error.mock.calls[0]?.[0])).toContain("JSON");
	});

	it("errors when the pasted token is empty and still closes the browser", async () => {
		await parseWithTail(program(), ["auth", "login"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("No token was pasted"),
		);
		expect(fakePuppeteer.browser.close).toHaveBeenCalledTimes(1);
	});

	it("rejects an authorize URL that is not http(s)", async () => {
		await parseWithTail(program(), [
			"auth",
			"login",
			"--authorize-url",
			"javascript:alert(1)",
		]);
		expect(authCmdMocks.openSystemBrowser).not.toHaveBeenCalled();
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("http or https"),
		);
	});

	it("falls back to the system browser when Puppeteer cannot launch", async () => {
		authCmdMocks.puppeteerLaunch
			.mockReset()
			.mockRejectedValueOnce(new Error("no chromium"));
		await parseWithTail(program(), ["auth", "login"]);
		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "latam");
		expect(authCmdMocks.openSystemBrowser).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
	});

	it("rejects an invalid --alias before opening anything", async () => {
		await parseWithTail(program(), ["auth", "login", "--alias", "Not Valid"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining(`"Not Valid" can't be used as an alias`),
		);
		expect(authCmdMocks.puppeteerLaunch).not.toHaveBeenCalled();
	});

	it("still works as the deprecated 'theme authorize', with a warning", async () => {
		fetchSpy.mockResolvedValueOnce(storeResponse(ACME));
		await parseWithTail(
			program({ name: "authorize", deprecatedFor: "auth login" }),
			["theme", "authorize", "--token", base64Payload(1, "t")],
		);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			"Warning: 'theme authorize' is deprecated. Use 'auth login' instead.",
		);
		expect(fixture.store.get("acme")).toBeDefined();
	});
});
