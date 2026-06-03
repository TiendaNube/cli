import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import { resolveApiCredentials } from "./theme-api-credentials";

function makeToken(payload: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("resolveApiCredentials", () => {
	let tmpFile: string;
	const tmpFiles: string[] = [];

	afterEach(() => {
		for (const file of tmpFiles.splice(0)) {
			if (fs.existsSync(file)) {
				fs.unlinkSync(file);
			}
		}
	});

	function newManager(): ThemeWorkspaceConfigManager {
		tmpFile = path.join(
			os.tmpdir(),
			`nube-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.cfg`,
		);
		tmpFiles.push(tmpFile);
		return new ThemeWorkspaceConfigManager(tmpFile);
	}

	it("decodes a valid token and returns ephemeral credentials without reading .nuvem", () => {
		// Workspace has NO .nuvem file — should still succeed via token.
		const workspace = newManager();
		const token = makeToken({ store_id: 9_080_701, access_token: "tok123" });

		const result = resolveApiCredentials({ token, workspace });

		expect(result).toEqual({
			success: true,
			config: { publicApiToken: "tok123", storeId: "9080701" },
			ephemeral: true,
		});
	});

	it("returns an error when the token is malformed", () => {
		const workspace = newManager();
		const result = resolveApiCredentials({
			token: "not-base64-json",
			workspace,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid --token/);
		}
	});

	it("preserves the underlying decode message in the error", () => {
		const workspace = newManager();
		// Valid base64 but missing access_token.
		const token = makeToken({ store_id: 1 });
		const result = resolveApiCredentials({ token, workspace });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid --token/);
			expect(result.error).toMatch(/access_token/);
		}
	});

	it("token takes precedence over .nuvem (does not touch the file)", () => {
		const workspace = newManager();
		workspace.writeWorkspace({
			themeManagement: "api",
			"theme-api": {
				publicApiToken: "from-file",
				storeId: "111",
				themeId: "999",
			},
		});
		const before = fs.readFileSync(tmpFile, "utf8");

		const token = makeToken({ store_id: 222, access_token: "from-token" });
		const result = resolveApiCredentials({ token, workspace });

		expect(result).toEqual({
			success: true,
			config: { publicApiToken: "from-token", storeId: "222" },
			ephemeral: true,
		});
		// .nuvem unchanged.
		expect(fs.readFileSync(tmpFile, "utf8")).toBe(before);
	});

	it("falls back to TryLoadApiConfig when no token is provided", () => {
		const workspace = newManager();
		workspace.writeWorkspace({
			themeManagement: "api",
			"theme-api": {
				publicApiToken: "from-file",
				storeId: "111",
				themeId: "999",
			},
		});

		const result = resolveApiCredentials({ token: undefined, workspace });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.publicApiToken).toBe("from-file");
			expect(result.config.storeId).toBe("111");
			expect(result.config.themeId).toBe("999");
			expect(result.ephemeral).toBe(false);
		}
	});

	it("treats blank/whitespace token as 'no token' and falls back to .nuvem", () => {
		const workspace = newManager();
		workspace.writeWorkspace({
			themeManagement: "api",
			"theme-api": { publicApiToken: "from-file", storeId: "111" },
		});

		const result = resolveApiCredentials({ token: "   ", workspace });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.publicApiToken).toBe("from-file");
			expect(result.ephemeral).toBe(false);
		}
	});

	it("propagates .nuvem errors when no token is provided", () => {
		const workspace = newManager();
		// No file written → IsSet() is false.
		const result = resolveApiCredentials({ token: undefined, workspace });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Store configuration not found/);
		}
	});
});
