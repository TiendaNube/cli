import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThemeFtpConfig } from "./theme-ftp-config";
import { ThemeFtpConfigManager } from "./theme-ftp-config-manager";

describe("ThemeFtpConfigManager", () => {
	let tmpFile: string;

	afterEach(() => {
		if (tmpFile && fs.existsSync(tmpFile)) {
			fs.unlinkSync(tmpFile);
		}
	});

	it("round-trips config with base64 on disk", () => {
		tmpFile = path.join(os.tmpdir(), `nube-test-${Date.now()}.cfg`);
		const config: ThemeFtpConfig = {
			ftp: {
				ftpServer: "ftp.example.com",
				ftpUsername: "u",
				ftpPassword: "p",
				verbose: false,
			},
			storeUrl: "https://store.example.com",
		};
		const manager = new ThemeFtpConfigManager(tmpFile);
		manager.Save(config);
		const raw = fs.readFileSync(tmpFile, "utf8");
		expect(raw.startsWith("{")).toBe(false);
		expect(manager.TryLoad()).toEqual({ success: true, config });
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
		const manager = new ThemeFtpConfigManager(tmpFile);
		const loaded = manager.TryLoad();
		expect(loaded.success).toBe(true);
		if (loaded.success) {
			expect(loaded.config.storeUrl).toBe("https://x");
		}
	});

	it("TryLoad fails with a clear message when JSON is invalid", () => {
		tmpFile = path.join(os.tmpdir(), `nube-bad-json-${Date.now()}.cfg`);
		fs.writeFileSync(tmpFile, "not-json{{{", "utf8");
		const manager = new ThemeFtpConfigManager(tmpFile);
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
		const manager = new ThemeFtpConfigManager(tmpFile);
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
		const manager = new ThemeFtpConfigManager(tmpFile);
		const result = manager.TryLoad();
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid "theme-ftp"/);
		}
	});
});
