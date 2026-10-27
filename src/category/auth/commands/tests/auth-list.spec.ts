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
import { AuthListCommand } from "../auth-list";
import {
	type AuthFixture,
	authCmdMocks,
	createAuthFixture,
	parseWithTail,
	programWith,
	resetAuthCmdMocks,
} from "./auth-command-test-mocks";

const SECRETS = ["api-secret-token", "ftp-secret-password", "ftp-user"];

const API: Identity = {
	alias: "shop",
	type: "store",
	createdAt: "2026-01-01T00:00:00.000Z",
	lastUsedAt: "2026-02-03T10:00:00.000Z",
	data: { storeId: "1", storeUrl: "https://shop.lojavirtualnuvem.com.br" },
	tokens: { api: { accessToken: "api-secret-token" } },
};

const FTP: Identity = {
	alias: "classic",
	type: "store",
	createdAt: "2026-01-02T00:00:00.000Z",
	data: { storeUrl: "https://classic.lojavirtualnuvem.com.br" },
	tokens: {
		ftp: {
			server: "ftp.example.com",
			username: "ftp-user",
			password: "ftp-secret-password",
		},
	},
};

describe("AuthListCommand", () => {
	let fixture: AuthFixture;
	let fetchSpy: MockInstance<typeof globalThis.fetch>;
	let stdout: MockInstance<typeof process.stdout.write>;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({ original_domain: "shop.lojavirtualnuvem.com.br" }),
		} as Response);
		stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.stubEnv("NUVEMSHOP_CLI_ALIAS", "");
		vi.stubEnv("TIENDANUBE_CLI_ALIAS", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		fixture.cleanup();
	});

	function run(argv: string[] = []) {
		return parseWithTail(
			programWith("auth", (c) => {
				new AuthListCommand(fixture.store, fixture.workspace).Bind(c);
			}),
			["auth", "list", ...argv],
		);
	}

	function printed(): string {
		return [
			...authCmdMocks.log.mock.calls.map((call) => String(call[0])),
			...stdout.mock.calls.map((call) => String(call[0])),
		].join("\n");
	}

	it("points at the login commands when nothing is stored", async () => {
		await run();
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining("auth login"),
		);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("lists every entry with its token kinds, host and verified status, marking the folder's alias", async () => {
		fixture.store.put(API);
		fixture.store.put(FTP);
		fixture.workspace.writeWorkspace({
			alias: "classic",
		});

		await run();

		const out = printed();
		expect(out).toMatch(
			/ {3}shop \(default\)\s+shop\.lojavirtualnuvem\.com\.br #1\s+API ok\s+2026-02-03/,
		);
		expect(out).toMatch(
			/> {2}classic\s+classic\.lojavirtualnuvem\.com\.br\s+FTP ok\s+never/,
		);
		expect(out).toContain(
			'> This folder uses "classic", linked in its .nuvem file.',
		);
		// Piped output carries no escape codes.
		expect(out).not.toContain("\u001b[");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(authCmdMocks.ftpTest).toHaveBeenCalledTimes(1);
	});

	it("reports a rejected credential instead of claiming it is fine", async () => {
		fixture.store.put(API);
		fetchSpy.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => "{}",
		} as Response);
		await run();
		expect(printed()).toContain("API rejected");
		expect(printed()).toContain(
			"Sign in again with:\n  tiendanube auth login --alias shop",
		);
	});

	it("tells an unreachable server apart from a rejected credential", async () => {
		fixture.store.put(FTP);
		authCmdMocks.ftpTest.mockResolvedValueOnce({
			success: false,
			errorMessage: "ETIMEDOUT",
		});
		await run();
		expect(printed()).toContain("FTP unreachable");
	});

	it("--no-verify makes no network call", async () => {
		fixture.store.put(API);
		fixture.store.put(FTP);
		await run(["--no-verify"]);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(authCmdMocks.ftpTest).not.toHaveBeenCalled();
		expect(printed()).toMatch(
			/shop \(default\)\s+shop\.lojavirtualnuvem\.com\.br #1\s+API\s+2026/,
		);
	});

	it("--json writes only the payload, with the folder's credential origin", async () => {
		fixture.store.put(API);
		vi.stubEnv("NUVEMSHOP_CLI_ALIAS", "shop");

		await run(["--json"]);

		expect(authCmdMocks.log).not.toHaveBeenCalled();
		const payload = JSON.parse(
			stdout.mock.calls.map((c) => String(c[0])).join(""),
		);
		expect(payload).toEqual({
			credentialsFile: fixture.store.FilePath,
			defaultAlias: "shop",
			currentFolder: { alias: "shop", source: "env" },
			identities: [
				{
					alias: "shop",
					type: "store",
					tokens: ["api"],
					storeId: "1",
					storeUrl: "https://shop.lojavirtualnuvem.com.br",
					host: "shop.lojavirtualnuvem.com.br",
					createdAt: API.createdAt,
					lastUsedAt: API.lastUsedAt,
					currentFolder: true,
					default: true,
					status: { api: "ok" },
				},
			],
		});
	});

	it("names the default as the origin of an unlinked folder", async () => {
		fixture.store.put(API);
		fixture.store.put(FTP);
		fixture.store.setDefault("classic");

		await run(["--no-verify"]);

		expect(printed()).toMatch(/> {2}classic \(default\)/);
		expect(printed()).toContain(
			'> This folder is not linked, so it uses "classic", the default credential.',
		);
	});

	it("never prints a token, a password or an FTP username, in text or JSON", async () => {
		fixture.store.put(API);
		fixture.store.put(FTP);
		await run();
		await run(["--json"]);
		const out = printed();
		for (const secret of SECRETS) {
			expect(out).not.toContain(secret);
		}
	});

	it("names a legacy inline credential as the folder's origin", async () => {
		fixture.store.put(API);
		fixture.workspace.writeWorkspace({
			"theme-api": { publicApiToken: "legacy", storeId: "9" },
		});
		await run(["--no-verify"]);
		expect(printed()).toContain("old-style credential inside .nuvem");
	});
});
