import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type { ThemeFtpConfig } from "./theme-ftp-config";
import { ThemeFtpConfigManager } from "./theme-ftp-config-manager";

describe("ThemeFtpConfigManager", () => {
	let tmpFile: string;
	let storeDir: string;
	let store: AuthCredentialsStore;

	beforeEach(() => {
		storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-ftp-store-"));
		store = new AuthCredentialsStore(path.join(storeDir, "credentials.json"));
		vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		if (tmpFile && fs.existsSync(tmpFile)) {
			fs.unlinkSync(tmpFile);
		}
		fs.rmSync(storeDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	const legacyConfig: ThemeFtpConfig = {
		ftp: {
			ftpServer: "ftp.example.com",
			ftpUsername: "u",
			ftpPassword: "p",
			verbose: false,
		},
		storeUrl: "https://store.example.com",
	};

	it("loads a legacy base64 workspace and moves the password out of it", () => {
		tmpFile = path.join(os.tmpdir(), `nube-test-${Date.now()}.cfg`);
		new ThemeWorkspaceConfigManager(tmpFile).writeWorkspace({
			"theme-ftp": legacyConfig,
		});
		const manager = new ThemeFtpConfigManager(tmpFile, store);

		expect(manager.TryLoad()).toEqual({
			success: true,
			config: legacyConfig,
			source: "workspace-alias",
			alias: "store",
		});

		const onDisk = Buffer.from(
			fs.readFileSync(tmpFile, "utf8"),
			"base64",
		).toString("utf8");
		expect(onDisk).not.toContain("ftp.example.com");
		expect(JSON.parse(onDisk)).toEqual({
			alias: "store",
		});
		expect(store.get("store")?.tokens.ftp).toEqual({
			server: "ftp.example.com",
			username: "u",
			password: "p",
		});

		// The second run resolves through the alias and returns the same login.
		expect(manager.TryLoad()).toMatchObject({
			success: true,
			config: legacyConfig,
			source: "workspace-alias",
		});
	});

	it("loads legacy plain JSON files", () => {
		tmpFile = path.join(os.tmpdir(), `nube-legacy-${Date.now()}.cfg`);
		const legacy = JSON.stringify({
			"theme-ftp": {
				ftp: {
					ftpServer: "a",
					ftpUsername: "b",
					ftpPassword: "c",
					verbose: false,
				},
				storeUrl: "https://x",
			},
		});
		fs.writeFileSync(tmpFile, legacy, "utf8");
		const manager = new ThemeFtpConfigManager(tmpFile, store);
		const loaded = manager.TryLoad();
		expect(loaded.success).toBe(true);
		if (loaded.success) {
			expect(loaded.config.storeUrl).toBe("https://x");
		}
	});

	it("TryLoad fails with a clear message when JSON is invalid", () => {
		tmpFile = path.join(os.tmpdir(), `nube-bad-json-${Date.now()}.cfg`);
		fs.writeFileSync(tmpFile, "not-json{{{", "utf8");
		const manager = new ThemeFtpConfigManager(tmpFile, store);
		const result = manager.TryLoad();
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid JSON/);
			expect(result.error).toContain(tmpFile);
		}
	});

	it("TryLoad fails when theme-ftp key is missing", () => {
		tmpFile = path.join(os.tmpdir(), `nube-no-key-${Date.now()}.cfg`);
		fs.writeFileSync(tmpFile, JSON.stringify({ other: {} }), "utf8");
		const manager = new ThemeFtpConfigManager(tmpFile, store);
		const result = manager.TryLoad();
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/theme-ftp/);
			expect(result.error).toContain(tmpFile);
		}
	});

	it("TryLoad fails when theme-ftp shape is invalid", () => {
		tmpFile = path.join(os.tmpdir(), `nube-bad-shape-${Date.now()}.cfg`);
		fs.writeFileSync(
			tmpFile,
			JSON.stringify({
				"theme-ftp": { storeUrl: "https://x" },
			}),
			"utf8",
		);
		const manager = new ThemeFtpConfigManager(tmpFile, store);
		const result = manager.TryLoad();
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid "theme-ftp"/);
		}
	});
});
