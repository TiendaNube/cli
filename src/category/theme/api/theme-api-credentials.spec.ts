import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../../auth/domain/auth-credentials-types";
import { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import { resolveApiCredentials } from "./theme-api-credentials";

function makeToken(payload: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function apiIdentity(
	alias: string,
	storeId: string,
	accessToken: string,
	extra: Partial<Identity> = {},
): Identity {
	return {
		alias,
		type: "store",
		createdAt: "2026-01-01T00:00:00.000Z",
		data: { storeId, storeUrl: `https://${alias}.lojavirtualnuvem.com.br` },
		tokens: { api: { accessToken } },
		...extra,
	};
}

describe("resolveApiCredentials", () => {
	let dir: string;
	let store: AuthCredentialsStore;
	const noEnv = {};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-api-creds-"));
		store = new AuthCredentialsStore(
			path.join(dir, "home", "credentials.json"),
		);
		vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.chmodSync(dir, 0o700);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function newWorkspace(name = ".nuvem"): {
		workspace: ThemeWorkspaceConfigManager;
		file: string;
	} {
		const file = path.join(
			dir,
			`${name}-${Math.random().toString(36).slice(2)}`,
		);
		return { workspace: new ThemeWorkspaceConfigManager(file), file };
	}

	function resolve(
		workspace: ThemeWorkspaceConfigManager,
		params: {
			token?: string;
			alias?: string;
			env?: Record<string, string>;
		} = {},
	) {
		return resolveApiCredentials({
			token: params.token,
			alias: params.alias,
			workspace,
			store,
			env: params.env ?? noEnv,
		});
	}

	describe("--token", () => {
		it("decodes a valid token and returns ephemeral credentials without reading .nuvem", () => {
			const { workspace } = newWorkspace();
			const token = makeToken({ store_id: 9_080_701, access_token: "tok123" });

			expect(resolve(workspace, { token })).toEqual({
				success: true,
				config: { publicApiToken: "tok123", storeId: "9080701" },
				ephemeral: true,
				source: "token",
			});
		});

		it("returns an error when the token is malformed, keeping the decode message", () => {
			const { workspace } = newWorkspace();
			const garbage = resolve(workspace, { token: "not-base64-json" });
			expect(garbage).toMatchObject({ success: false });
			const missing = resolve(workspace, { token: makeToken({ store_id: 1 }) });
			expect(missing.success).toBe(false);
			if (!missing.success) {
				expect(missing.error).toMatch(/Invalid --token/);
				expect(missing.error).toMatch(/access_token/);
			}
		});

		it("takes precedence over .nuvem and leaves the file untouched", () => {
			const { workspace, file } = newWorkspace();
			workspace.writeWorkspace({
				"theme-api": {
					publicApiToken: "from-file",
					storeId: "111",
					themeId: "999",
				},
			});
			const before = fs.readFileSync(file, "utf8");

			const token = makeToken({ store_id: 222, access_token: "from-token" });
			expect(resolve(workspace, { token })).toMatchObject({
				success: true,
				config: { publicApiToken: "from-token", storeId: "222" },
				ephemeral: true,
			});
			expect(fs.readFileSync(file, "utf8")).toBe(before);
		});

		it("refuses --token together with --alias, naming the flag to drop for each intent", () => {
			store.put(apiIdentity("acme", "1", "from-store"));
			const { workspace } = newWorkspace();
			const token = makeToken({ store_id: 2, access_token: "from-token" });

			const result = resolve(workspace, { token, alias: "acme" });
			expect(result.success).toBe(false);
			if (result.success) return;
			expect(result.error).toContain("--token and --alias");
			expect(result.error).toContain("keep --token and drop --alias");
			expect(result.error).toContain("keep --alias and drop --token");
		});

		it("wins over the alias environment variable without an error", () => {
			store.put(apiIdentity("acme", "1", "from-store"));
			const { workspace } = newWorkspace();
			const token = makeToken({ store_id: 2, access_token: "from-token" });

			expect(
				resolve(workspace, { token, env: { NUVEMSHOP_CLI_ALIAS: "acme" } }),
			).toMatchObject({
				success: true,
				config: { publicApiToken: "from-token", storeId: "2" },
				source: "token",
			});
		});

		it("treats a blank token as absent", () => {
			store.put(apiIdentity("acme", "1", "from-store"));
			const { workspace } = newWorkspace();
			expect(resolve(workspace, { token: "   ", alias: "acme" })).toMatchObject(
				{
					success: true,
					source: "alias-flag",
				},
			);
		});
	});

	describe("aliases", () => {
		it("--alias reads the stored token and borrows nothing from another store's folder", () => {
			store.put(apiIdentity("acme", "1", "acme-token"));
			store.put(apiIdentity("other", "2", "other-token"));
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({
				alias: "other",
				"theme-api": { themeId: "77" },
			});

			expect(resolve(workspace, { alias: "acme" })).toEqual({
				success: true,
				config: {
					publicApiToken: "acme-token",
					storeId: "1",
					storeUrl: "https://acme.lojavirtualnuvem.com.br",
				},
				ephemeral: true,
				source: "alias-flag",
				alias: "acme",
			});
		});

		it("the folder's own alias brings its theme id, but never a host for the stored token", () => {
			store.put(
				apiIdentity("acme", "1", "acme-token", {
					tokens: {
						api: {
							accessToken: "acme-token",
							apiBaseUrl: "https://from-store",
						},
					},
				}),
			);
			const { workspace } = newWorkspace();
			// What a malicious clone would ship: a guessable alias and its own host.
			workspace.writeWorkspace({
				alias: "acme",
				"theme-api": { themeId: "77", apiBaseUrl: "https://evil.example/" },
			});

			expect(resolve(workspace)).toMatchObject({
				success: true,
				config: {
					publicApiToken: "acme-token",
					themeId: "77",
					apiBaseUrl: "https://from-store",
				},
				ephemeral: false,
				source: "workspace-alias",
			});
			expect(store.get("acme")?.lastUsedAt).toBeDefined();
		});

		it("falls back to the default host, not the folder's, for a credential stored without one", () => {
			store.put(apiIdentity("acme", "1", "acme-token"));
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({
				alias: "acme",
				"theme-api": { apiBaseUrl: "https://evil.example" },
			});
			const result = resolve(workspace);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.config.apiBaseUrl).toBeUndefined();
			}
		});

		it("--alias naming the folder's own alias is not ephemeral", () => {
			store.put(apiIdentity("acme", "1", "acme-token"));
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({
				alias: "acme",
				"theme-api": { themeId: "77" },
			});

			expect(resolve(workspace, { alias: "acme" })).toMatchObject({
				config: { themeId: "77" },
				ephemeral: false,
			});
		});

		it("the environment variable sits between --alias and .nuvem", () => {
			store.put(apiIdentity("acme", "1", "acme-token"));
			store.put(apiIdentity("other", "2", "other-token"));
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({ alias: "other" });

			expect(
				resolve(workspace, { env: { TIENDANUBE_CLI_ALIAS: "acme" } }),
			).toMatchObject({ success: true, source: "env", alias: "acme" });
			expect(
				resolve(workspace, {
					alias: "other",
					env: { NUVEMSHOP_CLI_ALIAS: "acme" },
				}),
			).toMatchObject({ success: true, source: "alias-flag", alias: "other" });
		});

		it("refuses two alias variables that disagree", () => {
			const { workspace } = newWorkspace();
			const result = resolve(workspace, {
				env: { NUVEMSHOP_CLI_ALIAS: "a", TIENDANUBE_CLI_ALIAS: "b" },
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(
					/point to different credentials \("a" and "b"\)/,
				);
			}
		});

		it("names the fix for an unknown alias, a removed folder alias and a missing API token", () => {
			store.put({
				alias: "classic",
				type: "store",
				createdAt: "2026-01-01T00:00:00.000Z",
				data: { storeUrl: "https://classic.example" },
				tokens: { ftp: { server: "s", username: "u", password: "p" } },
			});
			const { workspace } = newWorkspace();

			const unknown = resolve(workspace, { alias: "nope" });
			expect(unknown.success).toBe(false);
			if (!unknown.success) {
				expect(unknown.error).toMatch(/no stored credential called "nope"/);
				expect(unknown.error).toMatch(/auth list/);
			}

			workspace.writeWorkspace({ alias: "gone" });
			const removed = resolve(workspace);
			if (!removed.success) {
				expect(removed.error).toMatch(
					/uses the credential "gone", but it is no longer stored/,
				);
			} else {
				throw new Error("expected a failure");
			}

			const ftpOnly = resolve(workspace, { alias: "classic" });
			if (!ftpOnly.success) {
				expect(ftpOnly.error).toMatch(/only has FTP credentials/);
				expect(ftpOnly.error).toMatch(/auth login --alias classic/);
			} else {
				throw new Error("expected a failure");
			}
		});

		it("an invalid credentials file fails loud even with a valid --alias", () => {
			fs.mkdirSync(path.dirname(store.FilePath), { recursive: true });
			fs.writeFileSync(store.FilePath, "{ not json");
			const { workspace } = newWorkspace();
			const result = resolve(workspace, { alias: "acme" });
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain(store.FilePath);
			}
		});
	});

	describe("legacy inline token", () => {
		it("keeps working and moves the token into credentials.json", () => {
			const { workspace, file } = newWorkspace();
			workspace.writeWorkspace({
				"theme-api": {
					publicApiToken: "from-file",
					storeId: "111",
					storeUrl: "https://acme.lojavirtualnuvem.com.br",
					installationId: "999",
				} as never,
			});

			expect(resolve(workspace)).toMatchObject({
				success: true,
				config: { publicApiToken: "from-file", storeId: "111", themeId: "999" },
				ephemeral: false,
				source: "workspace-alias",
				alias: "acme",
			});

			const raw = Buffer.from(fs.readFileSync(file, "utf8"), "base64").toString(
				"utf8",
			);
			expect(raw).not.toContain("from-file");
			expect(JSON.parse(raw)).toEqual({
				alias: "acme",
				"theme-api": { themeId: "999" },
			});
			expect(store.get("acme")?.tokens.api?.accessToken).toBe("from-file");

			// Idempotent: the next run goes through the alias.
			expect(resolve(workspace)).toMatchObject({
				success: true,
				config: { publicApiToken: "from-file", themeId: "999" },
				source: "workspace-alias",
			});
		});

		it("two legacy folders of the same store end up as one credential", () => {
			for (const themeId of ["1", "2"]) {
				const { workspace } = newWorkspace();
				workspace.writeWorkspace({
					"theme-api": {
						publicApiToken: `token-${themeId}`,
						storeId: "111",
						storeUrl: "https://acme.lojavirtualnuvem.com.br",
						themeId,
					},
				});
				expect(resolve(workspace)).toMatchObject({
					success: true,
					alias: "acme",
				});
			}
			expect(store.list()).toHaveLength(1);
			// The first one stored wins: a later file never replaces it.
			expect(store.get("acme")?.tokens.api?.accessToken).toBe("token-1");
		});

		it("a crafted legacy file cannot replace a stored token or point it at another host", () => {
			store.put(
				apiIdentity("victim", "111", "victim-token", {
					tokens: {
						api: {
							accessToken: "victim-token",
							apiBaseUrl: "https://from-store",
						},
					},
				}),
			);
			const before = store.get("victim");
			const { workspace, file } = newWorkspace();
			workspace.writeWorkspace({
				"theme-api": {
					publicApiToken: "attacker-token",
					storeId: "111",
					apiBaseUrl: "https://evil.example",
				},
			});

			expect(resolve(workspace)).toMatchObject({
				success: true,
				alias: "victim",
			});
			expect(store.get("victim")).toEqual(before);
			const raw = Buffer.from(fs.readFileSync(file, "utf8"), "base64").toString(
				"utf8",
			);
			expect(raw).not.toContain("evil.example");
			expect(raw).not.toContain("attacker-token");

			// And the next run sends the stored token to the stored host only.
			expect(resolve(workspace)).toMatchObject({
				config: {
					publicApiToken: "victim-token",
					apiBaseUrl: "https://from-store",
				},
			});
		});

		it("keeps a legacy file's own host with the new credential made from that same file", () => {
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({
				"theme-api": {
					publicApiToken: "staging-token",
					storeId: "5",
					storeUrl: "https://staging.example",
					apiBaseUrl: "https://api.staging.example",
				},
			});
			expect(resolve(workspace)).toMatchObject({
				success: true,
				alias: "staging",
			});
			expect(store.get("staging")?.tokens.api).toEqual({
				accessToken: "staging-token",
				apiBaseUrl: "https://api.staging.example",
			});
		});

		it("never fails the command when the credentials file cannot be written", () => {
			const { workspace, file } = newWorkspace();
			workspace.writeWorkspace({
				"theme-api": { publicApiToken: "from-file", storeId: "111" },
			});
			const before = fs.readFileSync(file, "utf8");
			fs.chmodSync(dir, 0o500);

			expect(resolve(workspace)).toMatchObject({
				success: true,
				config: { publicApiToken: "from-file" },
				source: "workspace-inline",
			});
			expect(fs.readFileSync(file, "utf8")).toBe(before);
		});

		it("explains how to get a credential when there is none", () => {
			const { workspace } = newWorkspace();
			const result = resolve(workspace);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(/auth login/);
			}
		});
	});

	describe("default alias", () => {
		it("serves a folder that is not linked, without writing or borrowing anything", () => {
			store.put(apiIdentity("shop", "1", "tok"));
			const { workspace, file } = newWorkspace();

			const result = resolve(workspace);

			expect(result).toMatchObject({
				success: true,
				config: { publicApiToken: "tok", storeId: "1" },
				ephemeral: true,
				source: "default",
				alias: "shop",
			});
			if (result.success) {
				expect(result.config.themeId).toBeUndefined();
			}
			expect(fs.existsSync(file)).toBe(false);
		});

		it("comes after --alias, the environment variable and the folder's own alias", () => {
			store.put(apiIdentity("shop", "1", "tok"));
			store.put(apiIdentity("other", "2", "tok2"));
			const { workspace } = newWorkspace();

			expect(resolve(workspace, { alias: "other" })).toMatchObject({
				source: "alias-flag",
				alias: "other",
			});
			expect(
				resolve(workspace, { env: { NUVEMSHOP_CLI_ALIAS: "other" } }),
			).toMatchObject({ source: "env", alias: "other" });

			workspace.linkAlias("other");
			expect(resolve(workspace)).toMatchObject({
				source: "workspace-alias",
				alias: "other",
			});
		});

		it("never stands in for a folder that holds a legacy credential of its own", () => {
			store.put(apiIdentity("shop", "1", "tok"));
			const { workspace } = newWorkspace();
			workspace.writeWorkspace({
				"theme-ftp": {
					ftp: {
						ftpServer: "s",
						ftpUsername: "u",
						ftpPassword: "p",
						verbose: false,
					},
					storeUrl: "https://classic.lojavirtualnuvem.com.br",
				},
			});

			const result = resolve(workspace);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(/only has FTP credentials/);
			}
		});

		it("never stands in for an unreadable .nuvem", () => {
			store.put(apiIdentity("shop", "1", "tok"));
			const { workspace, file } = newWorkspace();
			fs.writeFileSync(file, "not base64 json at all {");

			const result = resolve(workspace);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(/could not be read/);
			}
		});

		it("says the alias came from the default when it lacks the token", () => {
			store.put({
				...apiIdentity("classic", "1", "unused"),
				tokens: { ftp: { server: "s", username: "u", password: "p" } },
			});
			const { workspace } = newWorkspace();

			const result = resolve(workspace);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(
					/The default credential "classic" only has FTP credentials/,
				);
			}
		});
	});
});
