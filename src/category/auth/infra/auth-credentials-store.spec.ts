import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../domain/auth-credentials-types";
import {
	AuthCredentialsStore,
	CREDENTIALS_CONFIG_VERSION,
	resolveCredentialsPath,
} from "./auth-credentials-store";

const SHOP: Identity = {
	alias: "shop",
	type: "store",
	createdAt: "2026-01-01T00:00:00.000Z",
	data: { storeId: "1", storeUrl: "https://shop.lojavirtualnuvem.com.br" },
	tokens: {
		api: { accessToken: "api-token" },
		ftp: { server: "s", username: "u", password: "p" },
	},
};

describe("AuthCredentialsStore", () => {
	let dir: string;
	let file: string;
	let store: AuthCredentialsStore;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-creds-"));
		file = path.join(dir, "nested", "credentials.json");
		store = new AuthCredentialsStore(file);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function writeRaw(content: string): void {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}

	it("reads a missing file as empty without creating it", () => {
		expect(store.list()).toEqual([]);
		expect(fs.existsSync(file)).toBe(false);
	});

	it("round-trips identities with the schema version written by the store", () => {
		store.put(SHOP);
		expect(store.get("shop")).toEqual(SHOP);
		expect(JSON.parse(fs.readFileSync(file, "utf8")).configVersion).toBe(
			CREDENTIALS_CONFIG_VERSION,
		);
	});

	it.skipIf(process.platform === "win32")(
		"writes the file 0600 inside a 0700 directory",
		() => {
			store.put(SHOP);
			expect(fs.statSync(file).mode & 0o777).toBe(0o600);
			expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
		},
	);

	it.each([
		["invalid JSON", "{ nope", /not valid JSON/],
		["a non-object root", "[]", /must be a JSON object/],
		[
			"a non-numeric configVersion",
			JSON.stringify({ configVersion: "x", identities: [] }),
			/configVersion "x"/,
		],
		[
			"a non-list identities",
			JSON.stringify({ configVersion: 1, identities: {} }),
			/must be a list/,
		],
		[
			"an unknown identity type",
			JSON.stringify({
				configVersion: 1,
				identities: [{ ...SHOP, type: "partner" }],
			}),
			/unknown type "partner"/,
		],
		[
			"the pre-release merchant type",
			JSON.stringify({
				configVersion: 1,
				identities: [{ ...SHOP, type: "merchant" }],
			}),
			/unknown type "merchant"/,
		],
		[
			"a defaultAlias that is not an alias",
			JSON.stringify({ configVersion: 1, identities: [SHOP], defaultAlias: 7 }),
			/"defaultAlias" must be an alias/,
		],
		[
			"a token without its secret",
			JSON.stringify({
				configVersion: 1,
				identities: [{ ...SHOP, tokens: { api: {} } }],
			}),
			/"shop" has invalid tokens/,
		],
		[
			"a duplicate alias",
			JSON.stringify({ configVersion: 1, identities: [SHOP, SHOP] }),
			/alias "shop" appears more than once/,
		],
	])(
		"fails loud on %s, naming the file, and never overwrites it",
		(_name, content, message) => {
			writeRaw(content);
			expect(() => store.list()).toThrow(message);
			expect(() => store.list()).toThrow(file);
			expect(() => store.put({ ...SHOP, alias: "other" })).toThrow();
			expect(fs.readFileSync(file, "utf8")).toBe(content);
		},
	);

	it("asks for a CLI update, and deletes nothing, when a newer version wrote the file", () => {
		const content = JSON.stringify({ configVersion: 99, identities: [] });
		writeRaw(content);
		expect(() => store.list()).toThrow(/newer version of this CLI/);
		expect(() => store.list()).toThrow(/npm install -g @tiendanube\/cli/);
		expect(fs.readFileSync(file, "utf8")).toBe(content);
	});

	it("replaces an entry by alias and appends a new one", () => {
		store.put(SHOP);
		store.put({ ...SHOP, tokens: { api: { accessToken: "new" } } });
		store.put({ ...SHOP, alias: "second", data: { storeId: "2" } });
		expect(store.list().map((entry) => entry.alias)).toEqual([
			"shop",
			"second",
		]);
		expect(store.get("shop")?.tokens).toEqual({ api: { accessToken: "new" } });
	});

	it("finds entries by store id and by storefront host", () => {
		store.put(SHOP);
		expect(store.findByStoreId("1")?.alias).toBe("shop");
		expect(store.findByHost("shop.lojavirtualnuvem.com.br")?.alias).toBe(
			"shop",
		);
		expect(store.findByHost("other.example")).toBeUndefined();
	});

	it("removes one token and keeps the entry, then the entry with its last token", () => {
		store.put(SHOP);
		expect(store.removeToken("shop", "ftp")).toBe("removed");
		expect(store.get("shop")?.tokens).toEqual({ api: SHOP.tokens.api });
		expect(store.removeToken("shop", "ftp")).toBe("missing");
		expect(store.removeToken("shop", "api")).toBe("emptied");
		expect(store.get("shop")).toBeUndefined();
	});

	it("removes a whole identity", () => {
		store.put(SHOP);
		expect(store.removeIdentity("shop")).toBe(true);
		expect(store.removeIdentity("shop")).toBe(false);
	});

	it("makes the first credential stored in an empty file the default, and only that one", () => {
		store.put(SHOP);
		store.put({ ...SHOP, alias: "second", data: { storeId: "2" } });
		expect(store.defaultAlias()).toBe("shop");

		store.setDefault("second");
		store.touch("second");
		expect(store.defaultAlias()).toBe("second");
	});

	it("leaves no default once the default entry is gone, and picks none by itself", () => {
		store.put(SHOP);
		store.put({ ...SHOP, alias: "second", data: { storeId: "2" } });
		store.removeToken("shop", "ftp");
		expect(store.defaultAlias()).toBe("shop");

		store.removeIdentity("shop");
		expect(store.defaultAlias()).toBeUndefined();
		store.put({ ...SHOP, alias: "third", data: { storeId: "3" } });
		expect(store.defaultAlias()).toBeUndefined();

		store.setDefault("third");
		store.removeToken("third", "api");
		store.removeToken("third", "ftp");
		expect(store.defaultAlias()).toBeUndefined();
	});

	it("touch records the last use and never throws", () => {
		store.put(SHOP);
		store.touch("shop", new Date("2026-03-04T05:06:07.000Z"));
		expect(store.get("shop")?.lastUsedAt).toBe("2026-03-04T05:06:07.000Z");

		writeRaw("{ broken");
		expect(() => store.touch("shop")).not.toThrow();
		expect(fs.readFileSync(file, "utf8")).toBe("{ broken");
	});

	it("waits for a held lock, and gives up with an error instead of writing over it", () => {
		store.put(SHOP);
		fs.writeFileSync(`${file}.lock`, "");
		const started = Date.now();
		expect(() => store.put({ ...SHOP, alias: "other" })).toThrow(
			/Another command is saving credentials/,
		);
		expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
		expect(store.get("other")).toBeUndefined();

		// touch never waits.
		store.touch("shop");
		expect(store.get("shop")?.lastUsedAt).toBeUndefined();
	});

	it("takes over a lock left behind by a crashed run", () => {
		store.put(SHOP);
		const lock = `${file}.lock`;
		fs.writeFileSync(lock, "");
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(lock, old, old);
		store.put({ ...SHOP, alias: "other" });
		expect(store.get("other")).toBeDefined();
		expect(fs.existsSync(lock)).toBe(false);
	});

	it("leaves no temp file behind and no half-written file after a write", () => {
		store.put(SHOP);
		expect(fs.readdirSync(path.dirname(file))).toEqual(["credentials.json"]);
	});

	it("never resolves to the real per-user file under the test runner", () => {
		expect(resolveCredentialsPath().startsWith(os.tmpdir())).toBe(true);
	});
});
