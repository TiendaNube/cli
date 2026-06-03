import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ThemeWorkspaceConfigManager,
	mergeWorkspaceDocuments,
} from "./theme-workspace-config-manager";
import {
	findProductiveThemeId,
	resolveThemeId,
	resolveThemeIdWithProductive,
} from "./theme-workspace-types";

describe("resolveThemeId", () => {
	it("prefers CLI value over .nuvem", () => {
		expect(
			resolveThemeId("2", {
				publicApiToken: "t",
				storeId: "1",
				themeId: "9",
			}),
		).toBe("2");
	});

	it("falls back to theme-api.themeId", () => {
		expect(
			resolveThemeId(undefined, {
				publicApiToken: "t",
				storeId: "1",
				themeId: "42",
			}),
		).toBe("42");
	});

	it("returns null when neither is set", () => {
		expect(
			resolveThemeId(undefined, {
				publicApiToken: "t",
				storeId: "1",
			}),
		).toBe(null);
	});
});

describe("findProductiveThemeId", () => {
	it("returns the single productive theme id", async () => {
		const client = {
			listInstallations: async () => ({
				installations: [
					{ id: 10, is_productive: false },
					{ id: 11, is_productive: true },
				],
			}),
		};
		const result = await findProductiveThemeId(client);
		expect(result).toEqual({ ok: true, id: "11" });
	});

	it("errors when no productive theme exists", async () => {
		const client = {
			listInstallations: async () => ({
				installations: [{ id: 10, is_productive: false }],
			}),
		};
		const result = await findProductiveThemeId(client);
		expect(result).toEqual({
			ok: false,
			error: "No productive theme found for this store",
		});
	});

	it("errors when multiple productive themes exist", async () => {
		const client = {
			listInstallations: async () => ({
				installations: [
					{ id: 10, is_productive: true },
					{ id: 11, is_productive: true },
				],
			}),
		};
		const result = await findProductiveThemeId(client);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/Multiple productive/);
	});
});

describe("resolveThemeIdWithProductive", () => {
	const makeLogger = () => ({ Error: vi.fn() });
	const makeClient = (installations: unknown[]) => ({
		listInstallations: async () => ({ installations }),
	});

	it("returns productive id when --published is set", async () => {
		const logger = makeLogger();
		const id = await resolveThemeIdWithProductive({
			options: { published: true },
			config: { publicApiToken: "t", storeId: "1" },
			getClient: () =>
				makeClient([
					{ id: 10, is_productive: false },
					{ id: 22, is_productive: true },
				]),
			logger,
		});
		expect(id).toBe("22");
		expect(logger.Error).not.toHaveBeenCalled();
	});

	it("errors and returns null when both flags are set", async () => {
		const logger = makeLogger();
		const id = await resolveThemeIdWithProductive({
			options: { published: true, themeId: "5" },
			config: { publicApiToken: "t", storeId: "1" },
			getClient: () => makeClient([]),
			logger,
		});
		expect(id).toBeNull();
		expect(logger.Error).toHaveBeenCalledWith(
			"--published cannot be combined with --theme-id",
		);
	});

	it("falls back to resolveThemeId when productive flag is off", async () => {
		const logger = makeLogger();
		const id = await resolveThemeIdWithProductive({
			options: { themeId: "7" },
			config: { publicApiToken: "t", storeId: "1", themeId: "9" },
			getClient: () => {
				throw new Error("must not be called");
			},
			logger,
		});
		expect(id).toBe("7");
	});

	it("logs and returns null when listInstallations throws", async () => {
		const logger = makeLogger();
		const id = await resolveThemeIdWithProductive({
			options: { published: true },
			config: { publicApiToken: "t", storeId: "1" },
			getClient: () => ({
				listInstallations: async () => {
					throw new Error("boom");
				},
			}),
			logger,
		});
		expect(id).toBeNull();
		expect(logger.Error).toHaveBeenCalledWith("Failed to list themes: boom");
	});
});

describe("mergeWorkspaceDocuments", () => {
	it("merges theme-api shallowly and preserves unspecified keys", () => {
		const merged = mergeWorkspaceDocuments(
			{
				themeManagement: "api",
				"theme-api": {
					publicApiToken: "a",
					storeId: "1",
					storeUrl: "https://shop.example",
					themeId: "99",
					apiBaseUrl: "https://x",
				},
			},
			{
				"theme-api": {
					publicApiToken: "b",
					storeId: "1",
				},
			},
		);
		expect(merged["theme-api"]?.publicApiToken).toBe("b");
		expect(merged["theme-api"]?.themeId).toBe("99");
		expect(merged["theme-api"]?.storeUrl).toBe("https://shop.example");
		expect(merged["theme-api"]?.apiBaseUrl).toBe("https://x");
	});
});

describe("ThemeWorkspaceConfigManager API/FTP guards", () => {
	let tmpFile: string;

	afterEach(() => {
		if (tmpFile && fs.existsSync(tmpFile)) {
			fs.unlinkSync(tmpFile);
		}
	});

	it("TryLoadFtpConfig rejects when themeManagement is api", () => {
		tmpFile = path.join(os.tmpdir(), `nube-ws-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		const doc = {
			themeManagement: "api" as const,
			"theme-api": {
				publicApiToken: "t",
				storeId: "1",
			},
			"theme-ftp": {
				ftp: {
					ftpServer: "s",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: "https://x",
			},
		};
		m.writeWorkspace(doc);
		const r = m.TryLoadFtpConfig();
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error).toMatch(/api/i);
		}
	});

	it("TryLoadApiConfig rejects when themeManagement is ftp", () => {
		tmpFile = path.join(os.tmpdir(), `nube-ws2-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		const doc = {
			themeManagement: "ftp" as const,
			"theme-ftp": {
				ftp: {
					ftpServer: "s",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: "https://x",
			},
		};
		m.writeWorkspace(doc);
		const r = m.TryLoadApiConfig();
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error).toMatch(/FTP/i);
		}
	});

	it("migrates legacy installationId from .nuvem to themeId on read", () => {
		tmpFile = path.join(os.tmpdir(), `nube-ws3-${Date.now()}.cfg`);
		const legacyDoc = {
			themeManagement: "api",
			"theme-api": {
				publicApiToken: "t",
				storeId: "1",
				installationId: "4542075",
			},
		};
		fs.writeFileSync(
			tmpFile,
			Buffer.from(JSON.stringify(legacyDoc), "utf8").toString("base64"),
		);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		const r = m.TryLoadApiConfig();
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.config.themeId).toBe("4542075");
		}
	});
});
