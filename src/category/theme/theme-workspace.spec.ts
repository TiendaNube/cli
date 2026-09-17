import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StderrWriteSpy } from "./api/commands/tests/stderr-write-spy";
import { ThemeFtpConfigManager } from "./ftp/theme-ftp-config-manager";
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
	const makeClient = (installations: unknown[]) => ({
		listInstallations: async () => ({ installations }),
	});

	it("returns productive id when --published is set", async () => {
		const id = await resolveThemeIdWithProductive({
			options: { published: true },
			config: { publicApiToken: "t", storeId: "1" },
			getClient: () =>
				makeClient([
					{ id: 10, is_productive: false },
					{ id: 22, is_productive: true },
				]),
		});
		expect(id).toBe("22");
	});

	it("throws CliError when both flags are set", async () => {
		await expect(
			resolveThemeIdWithProductive({
				options: { published: true, themeId: "5" },
				config: { publicApiToken: "t", storeId: "1" },
				getClient: () => makeClient([]),
			}),
		).rejects.toThrow("--published cannot be combined with --theme-id");
	});

	it("falls back to resolveThemeId when productive flag is off", async () => {
		const id = await resolveThemeIdWithProductive({
			options: { themeId: "7" },
			config: { publicApiToken: "t", storeId: "1", themeId: "9" },
			getClient: () => {
				throw new Error("must not be called");
			},
		});
		expect(id).toBe("7");
	});

	it("throws CliError when listInstallations throws", async () => {
		await expect(
			resolveThemeIdWithProductive({
				options: { published: true },
				config: { publicApiToken: "t", storeId: "1" },
				getClient: () => ({
					listInstallations: async () => {
						throw new Error("boom");
					},
				}),
			}),
		).rejects.toThrow("Failed to list themes: boom");
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

	it("serves both families when both sections are present", () => {
		// themeManagement is advisory: the section each loader needs decides. This
		// is the case the flag used to block — API credentials refused because the
		// flag said "ftp", with a valid token sitting in the file.
		tmpFile = path.join(os.tmpdir(), `nube-ws-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		const both = {
			"theme-api": { publicApiToken: "t", storeId: "1" },
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

		for (const flag of ["api", "ftp", undefined] as const) {
			m.writeWorkspace(
				flag === undefined ? both : { ...both, themeManagement: flag },
			);
			expect(m.TryLoadApiConfig().success, `flag=${flag}`).toBe(true);
			expect(m.TryLoadFtpConfig().success, `flag=${flag}`).toBe(true);
		}
	});

	it("names the missing family instead of claiming the directory is the other one", () => {
		tmpFile = path.join(os.tmpdir(), `nube-ws-miss-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);

		// FTP credentials only: an API command should say what is missing.
		m.writeWorkspace({
			themeManagement: "ftp",
			"theme-ftp": {
				ftp: {
					ftpServer: "s",
					ftpUsername: "u",
					ftpPassword: "p",
					verbose: false,
				},
				storeUrl: "https://x",
			},
		});
		const api = m.TryLoadApiConfig();
		expect(api.success).toBe(false);
		if (!api.success) {
			expect(api.error).toMatch(/no Public API credentials/i);
			expect(api.error).toMatch(/theme authorize/);
		}

		// API credentials only: the mirror image.
		m.writeWorkspace({
			themeManagement: "api",
			"theme-api": { publicApiToken: "t", storeId: "1" },
		});
		const ftp = m.TryLoadFtpConfig();
		expect(ftp.success).toBe(false);
		if (!ftp.success) {
			expect(ftp.error).toMatch(/no FTP credentials/i);
			expect(ftp.error).toMatch(/theme ftp setup/);
		}
	});

	it("persists lastSync, which the writeWorkspace allowlist would drop", () => {
		// writeWorkspace rebuilds the object from known keys only, so a field added
		// to the type and to the merge alone never survives a write.
		tmpFile = path.join(os.tmpdir(), `nube-ws2-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		m.writeWorkspace({
			themeManagement: "api",
			"theme-api": { publicApiToken: "t", storeId: "1" },
		});

		m.recordLastSync("ftp");
		expect(m.readLastSync()).toBe("ftp");
		// The unrelated section must survive the merge.
		expect(m.TryLoadApiConfig().success).toBe(true);

		m.recordLastSync("api");
		expect(m.readLastSync()).toBe("api");
	});

	it("reports no sync origin for a workspace that never recorded one", () => {
		// Every pre-existing install is in this state, so it must not be treated
		// as a cross-family mismatch.
		tmpFile = path.join(os.tmpdir(), `nube-ws2b-${Date.now()}.cfg`);
		const m = new ThemeWorkspaceConfigManager(tmpFile);
		m.writeWorkspace({
			themeManagement: "api",
			"theme-api": { publicApiToken: "t", storeId: "1" },
		});
		expect(m.readLastSync()).toBeUndefined();
	});

	it("keeps writing themeManagement, which an older CLI still gates on", () => {
		// The loaders here ignore the flag, but a CLI installed before this change
		// refuses a workspace without it. `ftp setup` goes through the real
		// ThemeFtpConfigManager.Save on purpose: theme-ftp-setup.spec mocks Save,
		// so nothing else in the suite pins what actually lands in the file.
		tmpFile = path.join(os.tmpdir(), `nube-ws-compat-${Date.now()}.cfg`);
		const workspace = new ThemeWorkspaceConfigManager(tmpFile);

		// What `theme authorize` writes — see theme-api-setup-execute.ts.
		workspace.mergeWorkspace({
			themeManagement: "api",
			"theme-api": { publicApiToken: "t", storeId: "1" },
		});

		new ThemeFtpConfigManager(tmpFile).Save({
			ftp: {
				ftpServer: "s",
				ftpUsername: "u",
				ftpPassword: "p",
				verbose: false,
			},
			storeUrl: "https://x",
		});

		const onDisk = JSON.parse(
			Buffer.from(fs.readFileSync(tmpFile, "utf8"), "base64").toString("utf8"),
		);
		expect(onDisk.themeManagement).toBe("ftp");
		expect(onDisk["theme-api"]).toBeDefined();
		expect(onDisk["theme-ftp"]).toBeDefined();

		// And the point of the whole change: both families load anyway.
		expect(workspace.TryLoadApiConfig().success).toBe(true);
		expect(workspace.TryLoadFtpConfig().success).toBe(true);
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

describe("ThemeWorkspaceConfigManager legacy .nube migration", () => {
	const encodedDoc = Buffer.from(
		JSON.stringify({
			themeManagement: "api",
			"theme-api": { publicApiToken: "t", storeId: "1" },
		}),
		"utf8",
	).toString("base64");

	let prevCwd: string;
	let tmpDir: string;
	let stderrSpy: StderrWriteSpy;

	beforeEach(() => {
		prevCwd = process.cwd();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nube-migration-"));
		process.chdir(tmpDir);
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.chdir(prevCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function stderrText(): string {
		return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
	}

	it("migrates on first access, not on construction", () => {
		fs.writeFileSync(".nube", encodedDoc);

		const m = new ThemeWorkspaceConfigManager();

		expect(fs.existsSync(".nube")).toBe(true);
		expect(fs.existsSync(".nuvem")).toBe(false);
		expect(stderrText()).toBe("");

		expect(m.IsSet()).toBe(true);

		expect(fs.existsSync(".nube")).toBe(false);
		expect(fs.readFileSync(".nuvem", "utf8")).toBe(encodedDoc);
		expect(m.readWorkspace().themeManagement).toBe("api");
		expect(stderrText()).toContain("renamed");
	});

	it("migrates when writeWorkspace is the first access", () => {
		fs.writeFileSync(".nube", encodedDoc);

		const m = new ThemeWorkspaceConfigManager();
		m.writeWorkspace({ themeManagement: "ftp" });

		expect(fs.existsSync(".nube")).toBe(false);
		expect(m.readWorkspace().themeManagement).toBe("ftp");
		expect(stderrText()).toContain("renamed");
	});

	it("attempts the migration only once per instance", () => {
		fs.writeFileSync(".nube", encodedDoc);
		const m = new ThemeWorkspaceConfigManager();
		m.IsSet();

		fs.rmSync(".nuvem");
		fs.writeFileSync(".nube", "recreated elsewhere");
		m.IsSet();

		expect(fs.readFileSync(".nube", "utf8")).toBe("recreated elsewhere");
		expect(fs.existsSync(".nuvem")).toBe(false);
	});

	it("leaves a .nube directory untouched", () => {
		fs.mkdirSync(".nube");
		fs.writeFileSync(path.join(".nube", "keep-me"), "other project");

		new ThemeWorkspaceConfigManager().IsSet();

		expect(fs.statSync(".nube").isDirectory()).toBe(true);
		expect(fs.readFileSync(path.join(".nube", "keep-me"), "utf8")).toBe(
			"other project",
		);
		expect(fs.existsSync(".nuvem")).toBe(false);
		expect(stderrText()).toBe("");
	});

	it("keeps an existing .nuvem when both files are present", () => {
		fs.writeFileSync(".nuvem", encodedDoc);
		fs.writeFileSync(".nube", "legacy");

		new ThemeWorkspaceConfigManager().IsSet();

		expect(fs.readFileSync(".nuvem", "utf8")).toBe(encodedDoc);
		expect(fs.readFileSync(".nube", "utf8")).toBe("legacy");
		expect(stderrText()).toBe("");
	});

	it("does nothing when neither file is present", () => {
		expect(new ThemeWorkspaceConfigManager().IsSet()).toBe(false);

		expect(fs.existsSync(".nuvem")).toBe(false);
		expect(fs.existsSync(".nube")).toBe(false);
		expect(stderrText()).toBe("");
	});

	it("does not throw when the rename fails", () => {
		fs.writeFileSync(".nube", encodedDoc);
		vi.spyOn(fs, "renameSync").mockImplementation(() => {
			throw Object.assign(new Error("permission denied"), { code: "EACCES" });
		});
		const m = new ThemeWorkspaceConfigManager();

		expect(() => m.IsSet()).not.toThrow();

		expect(fs.readFileSync(".nube", "utf8")).toBe(encodedDoc);
		expect(stderrText()).toBe("");
	});

	it("does not migrate when an explicit config path is given", () => {
		fs.writeFileSync(".nube", encodedDoc);

		new ThemeWorkspaceConfigManager("custom.cfg").IsSet();

		expect(fs.readFileSync(".nube", "utf8")).toBe(encodedDoc);
		expect(fs.existsSync(".nuvem")).toBe(false);
		expect(stderrText()).toBe("");
	});
});
