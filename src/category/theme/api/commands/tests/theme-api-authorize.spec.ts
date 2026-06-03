import {
	type MockInstance,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const openSystemBrowserMock = vi.hoisted(() => vi.fn());
const puppeteerLaunchMock = vi.hoisted(() => vi.fn());

vi.mock("../../open-system-browser", () => ({
	openSystemBrowser: openSystemBrowserMock,
}));

vi.mock("puppeteer", () => ({
	default: { launch: puppeteerLaunchMock },
}));

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

import "./theme-api-command-test-mocks";
import {
	DEFAULT_PUBLIC_API_BASE_URL,
	DEFAULT_THEME_AUTHORIZE_URL,
} from "../../theme-api-constants";
import { ThemeApiAuthorizeCommand } from "../theme-api-authorize";
import {
	type FsReaddirSyncSpy,
	spyFsReaddirSyncMockNames,
} from "./fs-readdir-sync-spy";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import {
	getCliExecutableNameMock,
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

function base64Payload(storeId: number, accessToken: string): string {
	return Buffer.from(
		JSON.stringify({ store_id: storeId, access_token: accessToken }),
		"utf8",
	).toString("base64");
}

describe("ThemeApiAuthorizeCommand", () => {
	let readdirSpy: FsReaddirSyncSpy;
	let fetchSpy: MockInstance<typeof globalThis.fetch>;
	let fakePuppeteer: ReturnType<typeof makeFakePuppeteer>;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		openSystemBrowserMock.mockClear();
		fakePuppeteer = makeFakePuppeteer();
		puppeteerLaunchMock.mockReset();
		puppeteerLaunchMock.mockResolvedValue(fakePuppeteer.browser);
		readdirSpy = spyFsReaddirSyncMockNames([]);
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		readdirSpy.mockRestore();
		fetchSpy.mockRestore();
	});

	it("decodes token, fetches store URL, and runs setup", async () => {
		const mockStoreId = 9_080_701;
		const b64 = base64Payload(mockStoreId, "my-access-token");
		themeApiCmdMocks.input.mockResolvedValueOnce(b64);
		themeApiCmdMocks.listInstallations.mockResolvedValue([]);

		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					url_with_protocol: "https://acme-fixture.example.org",
					original_domain: "acme-fixture.example.org",
				}),
		} as Response);

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);

		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "latam");
		expect(puppeteerLaunchMock).toHaveBeenCalledTimes(1);
		expect(fakePuppeteer.page.goto).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
		expect(openSystemBrowserMock).not.toHaveBeenCalled();
		expect(fakePuppeteer.browser.close).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith(
			`${DEFAULT_PUBLIC_API_BASE_URL}/2025-03/9080701/store`,
			expect.objectContaining({ method: "GET" }),
		);
		const fetchInit = fetchSpy.mock.calls[0]?.[1] as { headers: Headers };
		expect(fetchInit.headers).toBeInstanceOf(Headers);
		expect(fetchInit.headers.get("Authentication")).toBe(
			"bearer my-access-token",
		);
		expect(themeApiCmdMocks.error).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.mergeWorkspace).toHaveBeenCalled();
	});

	it("uses --api-url for store fetch and setup base", async () => {
		const altStoreId = 55_501;
		const b64 = base64Payload(altStoreId, "tok");
		themeApiCmdMocks.input.mockResolvedValueOnce(b64);
		themeApiCmdMocks.listInstallations.mockResolvedValue([]);

		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					original_domain: "fallback-only.example.net",
				}),
		} as Response);

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"authorize",
			"--api-url",
			"https://api.fixture-cli.example",
		]);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.fixture-cli.example/2025-03/55501/store",
			expect.anything(),
		);
		expect(themeApiCmdMocks.mergeWorkspace).toHaveBeenCalled();
	});

	it("skips browser and prompt when --token is passed", async () => {
		const mockStoreId = 9_080_701;
		const b64 = base64Payload(mockStoreId, "flag-token");
		themeApiCmdMocks.listInstallations.mockResolvedValue([]);
		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					url_with_protocol: "https://flag-flow.example.org",
					original_domain: "flag-flow.example.org",
				}),
		} as Response);

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize", "--token", b64]);

		expect(openSystemBrowserMock).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.input).not.toHaveBeenCalled();
		expect(fetchSpy).toHaveBeenCalled();
		expect(themeApiCmdMocks.mergeWorkspace).toHaveBeenCalled();
		expect(themeApiCmdMocks.error).not.toHaveBeenCalled();
	});

	it("errors when --token decodes to invalid JSON without opening browser", async () => {
		const bad = Buffer.from("not-json", "utf8").toString("base64");
		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize", "--token", bad]);

		expect(openSystemBrowserMock).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.error).toHaveBeenCalled();
		expect(String(themeApiCmdMocks.error.mock.calls[0]?.[0])).toContain("JSON");
		expect(themeApiCmdMocks.mergeWorkspace).not.toHaveBeenCalled();
	});

	it("opens default authorize URL with region=br when CLI is nuvemshop", async () => {
		getCliExecutableNameMock.mockImplementation(() => "nuvemshop");
		themeApiCmdMocks.input.mockResolvedValueOnce("");

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);

		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "br");
		expect(puppeteerLaunchMock).toHaveBeenCalledTimes(1);
		expect(fakePuppeteer.page.goto).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
		expect(openSystemBrowserMock).not.toHaveBeenCalled();
	});

	it("errors when pasted token is empty", async () => {
		themeApiCmdMocks.input.mockResolvedValueOnce("");
		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("Token is required.");
	});

	it("errors when decoded JSON is invalid", async () => {
		const bad = Buffer.from("not-json", "utf8").toString("base64");
		themeApiCmdMocks.input.mockResolvedValueOnce(bad);
		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalled();
		expect(String(themeApiCmdMocks.error.mock.calls[0]?.[0])).toContain("JSON");
	});

	it("errors when store API returns non-OK", async () => {
		const b64 = base64Payload(1, "tok");
		themeApiCmdMocks.input.mockResolvedValueOnce(b64);
		fetchSpy.mockResolvedValueOnce({
			ok: false,
			status: 403,
			text: async () => JSON.stringify({ message: "Forbidden" }),
		} as Response);

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalled();
		expect(String(themeApiCmdMocks.error.mock.calls[0]?.[0])).toContain("403");
		expect(themeApiCmdMocks.mergeWorkspace).not.toHaveBeenCalled();
	});

	it("errors when authorize URL protocol is not http(s)", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"authorize",
			"--authorize-url",
			"javascript:alert(1)",
		]);
		expect(openSystemBrowserMock).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("http or https"),
		);
	});

	it("errors when authorize URL is not a valid URL", async () => {
		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, [
			"theme",
			"authorize",
			"--authorize-url",
			"not-a-url",
		]);
		expect(openSystemBrowserMock).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Invalid authorize URL.",
		);
	});

	it("falls back to openSystemBrowser when Puppeteer launch throws", async () => {
		puppeteerLaunchMock.mockReset();
		puppeteerLaunchMock.mockRejectedValueOnce(new Error("no chromium"));
		themeApiCmdMocks.input.mockResolvedValueOnce("");

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);

		const expectedAuthorize = new URL(DEFAULT_THEME_AUTHORIZE_URL);
		expectedAuthorize.searchParams.set("region", "latam");
		expect(puppeteerLaunchMock).toHaveBeenCalledTimes(1);
		expect(openSystemBrowserMock).toHaveBeenCalledWith(
			expectedAuthorize.toString(),
		);
		expect(fakePuppeteer.browser.close).not.toHaveBeenCalled();
	});

	it("closes the Puppeteer browser even when paste flow errors", async () => {
		const bad = Buffer.from("not-json", "utf8").toString("base64");
		themeApiCmdMocks.input.mockResolvedValueOnce(bad);

		const program = programWithThemeCommand((c) => {
			new ThemeApiAuthorizeCommand().Bind(c);
		});
		await parseWithTail(program, ["theme", "authorize"]);

		expect(puppeteerLaunchMock).toHaveBeenCalledTimes(1);
		expect(fakePuppeteer.browser.close).toHaveBeenCalledTimes(1);
	});
});
