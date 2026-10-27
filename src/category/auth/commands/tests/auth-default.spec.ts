import "./auth-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../../domain/auth-credentials-types";
import { AuthDefaultCommand } from "../auth-default";
import {
	type AuthFixture,
	authCmdMocks,
	createAuthFixture,
	forceInteractiveTestEnv,
	parseWithTail,
	programWith,
	resetAuthCmdMocks,
} from "./auth-command-test-mocks";

const SHOP: Identity = {
	alias: "shop",
	type: "store",
	createdAt: "2026-01-01T00:00:00.000Z",
	data: { storeId: "1", storeUrl: "https://shop.lojavirtualnuvem.com.br" },
	tokens: { api: { accessToken: "api-token" } },
};

describe("AuthDefaultCommand", () => {
	let fixture: AuthFixture;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
		fixture.store.put(SHOP);
		fixture.store.put({ ...SHOP, alias: "other", data: { storeId: "2" } });
	});

	afterEach(() => {
		fixture.cleanup();
	});

	function run(argv: string[]) {
		return parseWithTail(
			programWith("auth", (c) => {
				new AuthDefaultCommand(fixture.store).Bind(c);
			}),
			["auth", "default", ...argv],
		);
	}

	it("makes another stored credential the default", async () => {
		await run(["--alias", "other"]);
		expect(fixture.store.defaultAlias()).toBe("other");
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining('"other" (store #2) is now the default'),
		);
	});

	it("says so, and writes nothing new, when the alias already is the default", async () => {
		await run(["--alias", "shop"]);
		expect(fixture.store.defaultAlias()).toBe("shop");
		expect(authCmdMocks.log).toHaveBeenCalledWith(
			expect.stringContaining("is already the default"),
		);
	});

	it("refuses an alias that is not stored and keeps the default", async () => {
		await run(["--alias", "nope"]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining("auth list"),
		);
		expect(fixture.store.defaultAlias()).toBe("shop");
	});

	it("prompts for --alias when interactive, through the same validator", async () => {
		forceInteractiveTestEnv();
		authCmdMocks.input.mockResolvedValueOnce("other");
		await run([]);
		expect(fixture.store.defaultAlias()).toBe("other");

		await expect(run(["--alias", "Bad Alias"])).rejects.toThrow(
			/"Bad Alias" can't be used as an alias/,
		);
	});
});
