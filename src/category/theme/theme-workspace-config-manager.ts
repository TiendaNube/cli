import fs from "node:fs";
import { platform } from "node:process";
import { Chalk } from "chalk";
import { getCliExecutableName } from "../../cli-executable-name";
import type { ThemeFtpConfig } from "./ftp/theme-ftp-config";
import type {
	ThemeApiConfig,
	ThemeManagement,
	ThemeWorkspaceDocument,
} from "./theme-workspace-types";

const chalk = new Chalk();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidThemeFtpConfig(value: unknown): value is ThemeFtpConfig {
	if (!isRecord(value)) {
		return false;
	}
	const ftp = value.ftp;
	if (!isRecord(ftp)) {
		return false;
	}
	if (typeof ftp.ftpServer !== "string") {
		return false;
	}
	if (typeof ftp.ftpUsername !== "string") {
		return false;
	}
	if (typeof ftp.ftpPassword !== "string") {
		return false;
	}
	if (typeof ftp.verbose !== "boolean") {
		return false;
	}
	if (typeof value.storeUrl !== "string") {
		return false;
	}
	return true;
}

function isValidThemeApiConfig(value: unknown): value is ThemeApiConfig {
	if (!isRecord(value)) {
		return false;
	}
	if (
		typeof value.publicApiToken !== "string" ||
		value.publicApiToken.trim() === ""
	) {
		return false;
	}
	if (typeof value.storeId !== "string" || value.storeId.trim() === "") {
		return false;
	}
	if (value.themeId !== undefined && typeof value.themeId !== "string") {
		return false;
	}
	if (value.apiBaseUrl !== undefined && typeof value.apiBaseUrl !== "string") {
		return false;
	}
	if (value.storeUrl !== undefined && typeof value.storeUrl !== "string") {
		return false;
	}
	return true;
}

/**
 * Pre-EXT-518 `.nuvem` files persisted the theme reference as `installationId`.
 * Surface it as `themeId` on read so existing workspaces keep working — the
 * next `writeWorkspace` re-persists with only the new key.
 */
function migrateLegacyThemeApiFields(
	value: Record<string, unknown>,
): Record<string, unknown> {
	if (value.themeId !== undefined) {
		return value;
	}
	if (typeof value.installationId !== "string") {
		return value;
	}
	const { installationId, ...rest } = value;
	return { ...rest, themeId: installationId };
}

function parseManagement(value: unknown): ThemeManagement | undefined {
	if (value === "ftp" || value === "api") {
		return value;
	}
	return undefined;
}

export function mergeWorkspaceDocuments(
	existing: ThemeWorkspaceDocument,
	patch: Partial<ThemeWorkspaceDocument>,
): ThemeWorkspaceDocument {
	const next: ThemeWorkspaceDocument = { ...existing };

	if (patch.themeManagement !== undefined) {
		next.themeManagement = patch.themeManagement;
	}
	if (patch["theme-ftp"] !== undefined) {
		next["theme-ftp"] = patch["theme-ftp"];
	}
	if (patch["theme-api"] !== undefined) {
		next["theme-api"] = {
			...existing["theme-api"],
			...patch["theme-api"],
		};
	}
	return next;
}

export class ThemeWorkspaceConfigManager {
	public constructor(private readonly configFilePath = ".nuvem") {
		if (
			configFilePath === ".nuvem" &&
			!fs.existsSync(".nuvem") &&
			fs.existsSync(".nube")
		) {
			fs.renameSync(".nube", ".nuvem");
			process.stderr.write(
				chalk.yellow(
					'NOTE: Your ".nube" config file has been automatically renamed to ".nuvem". The CLI now uses ".nuvem" — no action required on your end.\n',
				),
			);
		}
	}

	IsSet(): boolean {
		return fs.existsSync(this.configFilePath);
	}

	/** Decode file to a workspace document (may be empty object if file missing). */
	readWorkspace(): ThemeWorkspaceDocument {
		if (!this.IsSet()) {
			return {};
		}
		let raw: string;
		try {
			raw = fs.readFileSync(this.configFilePath, "utf8").trim();
		} catch (cause) {
			const msg = `Failed to read workspace configuration file "${this.configFilePath}".`;
			throw cause instanceof Error
				? new Error(`${msg} ${cause.message}`, { cause })
				: new Error(msg, { cause });
		}

		let parsed: unknown;
		try {
			const json =
				raw.startsWith("{") || raw.startsWith("[")
					? raw
					: Buffer.from(raw, "base64").toString("utf8");
			parsed = JSON.parse(json);
		} catch (cause) {
			const msg = `Invalid JSON in "${this.configFilePath}" (expected base64-encoded JSON or plain JSON).`;
			throw cause instanceof Error
				? new Error(`${msg} ${cause.message}`, { cause })
				: new Error(msg, { cause });
		}

		if (!isRecord(parsed)) {
			throw new Error(
				`Invalid content in "${this.configFilePath}": root value must be a JSON object.`,
			);
		}

		const doc: ThemeWorkspaceDocument = {};
		const tm = parseManagement(parsed.themeManagement);
		if (tm !== undefined) {
			doc.themeManagement = tm;
		}
		if (parsed["theme-ftp"] !== undefined) {
			doc["theme-ftp"] = parsed["theme-ftp"] as ThemeFtpConfig;
		}
		if (parsed["theme-api"] !== undefined) {
			const themeApi = parsed["theme-api"];
			doc["theme-api"] = (
				isRecord(themeApi) ? migrateLegacyThemeApiFields(themeApi) : themeApi
			) as ThemeApiConfig;
		}
		return doc;
	}

	writeWorkspace(doc: ThemeWorkspaceDocument): void {
		const json = JSON.stringify({
			...(doc.themeManagement !== undefined
				? { themeManagement: doc.themeManagement }
				: {}),
			...(doc["theme-ftp"] !== undefined
				? { "theme-ftp": doc["theme-ftp"] }
				: {}),
			...(doc["theme-api"] !== undefined
				? { "theme-api": doc["theme-api"] }
				: {}),
		});
		const encoded = Buffer.from(json, "utf8").toString("base64");
		if (platform !== "win32") {
			fs.writeFileSync(this.configFilePath, encoded, {
				encoding: "utf8",
				mode: 0o600,
			});
			fs.chmodSync(this.configFilePath, 0o600);
		} else {
			fs.writeFileSync(this.configFilePath, encoded, "utf8");
		}
	}

	mergeWorkspace(patch: Partial<ThemeWorkspaceDocument>): void {
		const current = this.IsSet() ? this.readWorkspace() : {};
		const merged = mergeWorkspaceDocuments(current, patch);
		this.writeWorkspace(merged);
	}

	TryLoadFtpConfig():
		| { success: true; config: ThemeFtpConfig }
		| { success: false; error: string } {
		try {
			if (!this.IsSet()) {
				return {
					success: false,
					error: `Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
				};
			}
			const doc = this.readWorkspace();
			const management = doc.themeManagement;
			if (management === "api") {
				return {
					success: false,
					error: `This directory is configured for theme API sync. Use ${getCliExecutableName()} theme authorize, theme pull, theme push, or theme watch instead.`,
				};
			}
			const themeFtp = doc["theme-ftp"];
			if (themeFtp === undefined) {
				return {
					success: false,
					error: `Missing required "theme-ftp" key in "${this.configFilePath}".`,
				};
			}
			if (!isValidThemeFtpConfig(themeFtp)) {
				return {
					success: false,
					error: `Invalid "theme-ftp" configuration in "${this.configFilePath}": expected { ftp: { ftpServer, ftpUsername, ftpPassword, verbose }, storeUrl } with string and boolean fields as produced by ${getCliExecutableName()} theme ftp setup.`,
				};
			}
			return { success: true, config: themeFtp };
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			return {
				success: false,
				error: `Store configuration could not be loaded. ${detail}`,
			};
		}
	}

	TryLoadApiConfig():
		| {
				success: true;
				config: ThemeApiConfig;
				themeManagement: ThemeManagement;
		  }
		| { success: false; error: string } {
		try {
			if (!this.IsSet()) {
				return {
					success: false,
					error: `Store configuration not found. Please run ${getCliExecutableName()} theme authorize first.`,
				};
			}
			const doc = this.readWorkspace();
			if (doc.themeManagement === "ftp") {
				return {
					success: false,
					error: `This directory is configured for FTP theme sync. Use ${getCliExecutableName()} theme ftp pull, theme ftp push, or theme ftp watch instead.`,
				};
			}
			if (doc.themeManagement !== "api") {
				return {
					success: false,
					error: `Theme API is not active. Run ${getCliExecutableName()} theme authorize and use theme pull, theme push, or theme watch.`,
				};
			}
			const themeApi = doc["theme-api"];
			if (themeApi === undefined) {
				return {
					success: false,
					error: `Missing required "theme-api" key in "${this.configFilePath}".`,
				};
			}
			if (!isValidThemeApiConfig(themeApi)) {
				return {
					success: false,
					error: `Invalid "theme-api" in "${this.configFilePath}": expected publicApiToken and storeId (strings) as produced by ${getCliExecutableName()} theme authorize.`,
				};
			}
			return {
				success: true,
				config: {
					publicApiToken: themeApi.publicApiToken.trim(),
					storeId: themeApi.storeId.trim(),
					...(themeApi.storeUrl !== undefined && themeApi.storeUrl.trim() !== ""
						? { storeUrl: themeApi.storeUrl.trim() }
						: {}),
					...(themeApi.themeId !== undefined
						? { themeId: themeApi.themeId.trim() }
						: {}),
					...(themeApi.apiBaseUrl !== undefined &&
					themeApi.apiBaseUrl.trim() !== ""
						? { apiBaseUrl: themeApi.apiBaseUrl.trim().replace(/\/+$/, "") }
						: {}),
				},
				themeManagement: "api",
			};
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			return {
				success: false,
				error: `Store configuration could not be loaded. ${detail}`,
			};
		}
	}
}
