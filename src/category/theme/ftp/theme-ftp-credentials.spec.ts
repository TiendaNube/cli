import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../../auth/domain/auth-credentials-types";
import { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import { resolveFtpCredentials } from "./theme-ftp-credentials";

const CLASSIC: Identity = {
	alias: "classic",
	type: "store",
	createdAt: "2026-01-01T00:00:00.000Z",
	data: { storeUrl: "https://classic.lojavirtualnuvem.com.br" },
	tokens: { ftp: { server: "ftp.example.com", username: "u", password: "p" } },
};

describe("resolveFtpCredentials", () => {
	let dir: string;
	let store: AuthCredentialsStore;
	let workspace: ThemeWorkspaceConfigManager;
	let workspaceFile: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-ftp-creds-"));
		store = new AuthCredentialsStore(path.join(dir, "credentials.json"));
		workspaceFile = path.join(dir, ".nuvem");
		workspace = new ThemeWorkspaceConfigManager(workspaceFile);
		vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const resolve = (alias?: string, env: Record<string, string> = {}) =>
		resolveFtpCredentials({ alias, workspace, store, env });

	it("--alias works in a folder that has no .nuvem at all", () => {
		store.put(CLASSIC);
		expect(resolve("classic")).toEqual({
			success: true,
			config: {
				ftp: {
					ftpServer: "ftp.example.com",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: "https://classic.lojavirtualnuvem.com.br",
			},
			source: "alias-flag",
			alias: "classic",
		});
		expect(fs.existsSync(workspaceFile)).toBe(false);
	});

	it("reads the environment variable, then the folder's alias", () => {
		store.put(CLASSIC);
		store.put({
			...CLASSIC,
			alias: "other",
			data: { storeUrl: "https://other.example" },
		});
		workspace.linkAlias("other");

		expect(
			resolve(undefined, { NUVEMSHOP_CLI_ALIAS: "classic" }),
		).toMatchObject({
			source: "env",
			alias: "classic",
		});
		expect(resolve()).toMatchObject({
			source: "workspace-alias",
			alias: "other",
		});
	});

	it("falls back to the default alias in a folder that is not linked", () => {
		store.put(CLASSIC);
		expect(resolve()).toMatchObject({
			success: true,
			source: "default",
			alias: "classic",
		});
		expect(fs.existsSync(workspaceFile)).toBe(false);
	});

	it("names auth ftp when the alias has only an API token", () => {
		store.put({
			...CLASSIC,
			data: { storeId: "1", storeUrl: CLASSIC.data.storeUrl },
			tokens: { api: { accessToken: "t" } },
		});
		const result = resolve("classic");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/auth ftp --alias classic/);
		}
	});

	it("explains how to get a credential when the folder has none", () => {
		const result = resolve();
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/auth ftp/);
			expect(result.error).toMatch(/auth link --alias/);
		}
	});

	it("migrates a folder holding both legacy sections into one entry with both tokens", () => {
		workspace.writeWorkspace({
			"theme-api": {
				publicApiToken: "api-secret",
				storeId: "7",
				storeUrl: "https://both.lojavirtualnuvem.com.br",
			},
			"theme-ftp": {
				ftp: {
					ftpServer: "f",
					ftpUsername: "u",
					ftpPassword: "ftp-secret",
					verbose: false,
				},
				storeUrl: "https://both.lojavirtualnuvem.com.br",
			},
		});

		expect(resolve()).toMatchObject({ success: true, alias: "both" });
		expect(store.list()).toHaveLength(1);
		expect(store.get("both")?.tokens).toEqual({
			api: { accessToken: "api-secret" },
			ftp: { server: "f", username: "u", password: "ftp-secret" },
		});
		const raw = Buffer.from(
			fs.readFileSync(workspaceFile, "utf8"),
			"base64",
		).toString("utf8");
		expect(raw).not.toContain("secret");
		expect(JSON.parse(raw)).toEqual({ alias: "both" });
	});

	it("a legacy FTP login never replaces the one stored for the same storefront", () => {
		store.put(CLASSIC);
		workspace.writeWorkspace({
			"theme-ftp": {
				ftp: {
					ftpServer: "ftp.evil.example",
					ftpUsername: "x",
					ftpPassword: "y",
					verbose: false,
				},
				storeUrl: CLASSIC.data.storeUrl ?? "",
			},
		});

		expect(resolve()).toMatchObject({ success: true, alias: "classic-2" });
		expect(store.get("classic")).toEqual(CLASSIC);
		expect(store.get("classic-2")?.tokens.ftp?.server).toBe("ftp.evil.example");
	});

	it("an identical legacy FTP login reuses the stored entry", () => {
		store.put(CLASSIC);
		workspace.writeWorkspace({
			"theme-ftp": {
				ftp: {
					ftpServer: "ftp.example.com",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: CLASSIC.data.storeUrl ?? "",
			},
		});
		expect(resolve()).toMatchObject({ success: true, alias: "classic" });
		expect(store.list()).toHaveLength(1);
	});
});
