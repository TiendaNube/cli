import "./auth-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../../domain/auth-credentials-types";
import { AuthRemoveCommand } from "../auth-remove";
import {
	type AuthFixture,
	authCmdMocks,
	createAuthFixture,
	forceInteractiveTestEnv,
	parseWithTail,
	programWith,
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

describe("AuthRemoveCommand", () => {
	let fixture: AuthFixture;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
		fixture.store.put(BOTH);
	});

	afterEach(() => {
		fixture.cleanup();
	});

	function run(argv: string[]) {
		return parseWithTail(
			programWith("auth", (c) => {
				new AuthRemoveCommand(fixture.store, fixture.workspace).Bind(c);
			}),
			["auth", "remove", ...argv],
		);
	}

	it("refuses without --yes in a non-interactive run, before touching the store", async () => {
		await run(["--alias", "shop"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("requires confirmation"),
		);
		expect(fixture.store.get("shop")).toBeDefined();
	});

	it("removes the whole entry with --yes", async () => {
		await run(["--alias", "shop", "-y"]);
		expect(fixture.store.get("shop")).toBeUndefined();
	});

	it("keeps the entry when the user declines", async () => {
		forceInteractiveTestEnv();
		authCmdMocks.confirm.mockResolvedValueOnce(false);
		await run(["--alias", "shop"]);
		expect(fixture.store.get("shop")).toBeDefined();
	});

	it("--ftp removes one token and keeps the rest of the entry", async () => {
		await run(["--alias", "shop", "--ftp", "-y"]);
		expect(fixture.store.get("shop")?.tokens).toEqual({ api: BOTH.tokens.api });

		await run(["--alias", "shop", "--api", "-y"]);
		expect(fixture.store.get("shop")).toBeUndefined();
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining("entirely, since it held nothing else"),
		);
	});

	it("warns when the current folder is linked to the removed alias", async () => {
		fixture.workspace.linkAlias("shop");
		await run(["--alias", "shop", "-y"]);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			expect.stringContaining('This folder was using "shop"'),
		);
	});

	it("says there is no default any more when the default is removed, and picks none", async () => {
		fixture.store.put({ ...BOTH, alias: "other", data: { storeId: "2" } });
		await run(["--alias", "shop", "-y"]);
		expect(fixture.store.defaultAlias()).toBeUndefined();
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			expect.stringContaining("auth default --alias <alias>"),
		);
	});

	it("keeps the default and says nothing about it when only one of its tokens goes", async () => {
		await run(["--alias", "shop", "--ftp", "-y"]);
		expect(fixture.store.defaultAlias()).toBe("shop");
		expect(authCmdMocks.warn).not.toHaveBeenCalled();
	});

	it("errors for an unknown alias or a token the entry does not have", async () => {
		await run(["--alias", "nope", "-y"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("auth list"),
		);

		fixture.store.removeToken("shop", "ftp");
		await run(["--alias", "shop", "--ftp", "-y"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("no FTP credentials"),
		);
	});
});
