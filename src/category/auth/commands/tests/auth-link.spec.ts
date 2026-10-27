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
import type { Identity } from "../../domain/auth-credentials-types";
import { AuthLinkCommand } from "../auth-link";
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

const BOTH: Identity = {
	alias: "shop",
	type: "store",
	createdAt: "2026-01-01T00:00:00.000Z",
	data: { storeId: "1", storeUrl: "https://shop.lojavirtualnuvem.com.br" },
	tokens: {
		api: { accessToken: "api-token" },
		ftp: { server: "s", username: "u", password: "p" },
	},
};

describe("AuthLinkCommand", () => {
	let fixture: AuthFixture;
	let fetchSpy: MockInstance<typeof globalThis.fetch>;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({ original_domain: "shop.lojavirtualnuvem.com.br" }),
		} as Response);
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		fixture.cleanup();
	});

	function run(argv: string[]) {
		return parseWithTail(
			programWith("auth", (c) => {
				new AuthLinkCommand(fixture.store, fixture.workspace).Bind(c);
			}),
			["auth", "link", ...argv],
		);
	}

	it("verifies the API token and links the folder without signing in", async () => {
		fixture.store.put({ ...BOTH, tokens: { api: BOTH.tokens.api } });
		await run(["--alias", "shop"]);

		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/1/store"),
			expect.anything(),
		);
		expect(readNuvem(fixture.workspaceFile)).toEqual({
			alias: "shop",
		});
		expect(authCmdMocks.error).not.toHaveBeenCalled();
	});

	it("tests the FTP login for an FTP-only entry and says how to add the API one", async () => {
		fixture.store.put({
			...BOTH,
			data: { storeUrl: BOTH.data.storeUrl },
			tokens: { ftp: BOTH.tokens.ftp },
		});
		await run(["--alias", "shop"]);
		expect(authCmdMocks.ftpTest).toHaveBeenCalledTimes(1);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(readNuvem(fixture.workspaceFile)).toEqual({ alias: "shop" });
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining(
				'"shop" has no Public API credentials; add them with tiendanube auth login --alias shop',
			),
		);
	});

	it("checks both credentials of an entry that holds both, with no flag to choose", async () => {
		fixture.store.put(BOTH);
		await run(["--alias", "shop"]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(authCmdMocks.ftpTest).toHaveBeenCalledTimes(1);
		expect(authCmdMocks.warn).not.toHaveBeenCalled();
		expect(readNuvem(fixture.workspaceFile)).toEqual({ alias: "shop" });
	});

	it("warns about a refused FTP login and still links the folder", async () => {
		fixture.store.put(BOTH);
		authCmdMocks.ftpTest.mockResolvedValueOnce({
			success: false,
			errorMessage: "530 Login incorrect",
		});
		await run(["--alias", "shop"]);
		expect(authCmdMocks.warn).toHaveBeenCalledTimes(1);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			expect.stringContaining("auth ftp --alias shop"),
		);
		expect(authCmdMocks.error).not.toHaveBeenCalled();
		expect(readNuvem(fixture.workspaceFile)).toEqual({ alias: "shop" });
	});

	it("links the folder even when no credential can be checked or works", async () => {
		fixture.store.put(BOTH);
		fetchSpy.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => JSON.stringify({ message: "Unauthorized" }),
		} as Response);
		authCmdMocks.ftpTest.mockResolvedValueOnce({
			success: false,
			errorMessage: "getaddrinfo ENOTFOUND s",
		});
		await run(["--alias", "shop"]);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			expect.stringContaining("auth login --alias shop"),
		);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			expect.stringContaining("could not check the FTP credentials"),
		);
		expect(authCmdMocks.error).not.toHaveBeenCalled();
		expect(readNuvem(fixture.workspaceFile)).toEqual({ alias: "shop" });
	});

	it("has no --api or --ftp flag", async () => {
		fixture.store.put(BOTH);
		const program = programWith("auth", (c) => {
			new AuthLinkCommand(fixture.store, fixture.workspace).Bind(c);
		});
		program.commands[0]?.commands[0]?.exitOverride().configureOutput({
			writeErr: () => {},
		});
		await expect(
			parseWithTail(program, ["auth", "link", "--alias", "shop", "--ftp"]),
		).rejects.toThrow(/unknown option '--ftp'/);
		expect(readNuvem(fixture.workspaceFile)).toBeNull();
	});

	it("never sends the stored token to a host named by the folder's .nuvem", async () => {
		fixture.store.put({ ...BOTH, tokens: { api: BOTH.tokens.api } });
		fixture.workspace.writeWorkspace({
			alias: "shop",
			"theme-api": { apiBaseUrl: "https://evil.example" },
		});
		await run(["--alias", "shop"]);

		const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
		expect(urls).toHaveLength(1);
		expect(urls[0]).toMatch(/^https:\/\/api\.nuvemshop\.com\.br\//);
		expect(readNuvem(fixture.workspaceFile)).toEqual({
			alias: "shop",
		});
	});

	it("uses an explicit --api-url for the check", async () => {
		fixture.store.put({ ...BOTH, tokens: { api: BOTH.tokens.api } });
		await run(["--alias", "shop", "--api-url", "https://api.staging.example"]);
		expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(
			/^https:\/\/api\.staging\.example\//,
		);
	});

	it("names auth list for an unknown alias", async () => {
		await run(["--alias", "nope"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("auth list"),
		);
	});

	it("replaces an inline legacy token and drops the theme id of another store", async () => {
		fixture.store.put({ ...BOTH, tokens: { api: BOTH.tokens.api } });
		fixture.workspace.writeWorkspace({
			"theme-api": { publicApiToken: "legacy", storeId: "999", themeId: "42" },
		});
		await run(["--alias", "shop"]);
		expect(readNuvem(fixture.workspaceFile)).toEqual({
			alias: "shop",
		});
	});

	it("prompts for --alias when interactive, through the same validator", async () => {
		fixture.store.put({ ...BOTH, tokens: { api: BOTH.tokens.api } });
		forceInteractiveTestEnv();
		authCmdMocks.input.mockResolvedValueOnce("shop");
		await run([]);
		expect(readNuvem(fixture.workspaceFile)).toMatchObject({ alias: "shop" });

		await expect(run(["--alias", "Bad Alias"])).rejects.toThrow(
			/"Bad Alias" can't be used as an alias/,
		);
	});
});
