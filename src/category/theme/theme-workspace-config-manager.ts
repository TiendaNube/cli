import fs from "node:fs";
import { platform } from "node:process";
import { Chalk } from "chalk";
import { getCliExecutableName } from "../../cli-executable-name";
import { noCredentialsError } from "../auth/domain/auth-credential-source";
import type { ThemeFtpConfig } from "./ftp/theme-ftp-config";
import type {
	ThemeApiConfig,
	ThemeApiWorkspaceSection,
	ThemeSyncFamily,
	ThemeWorkspaceDocument,
} from "./theme-workspace-types";

const chalk = new Chalk();

const CONFIG_FILE_NAME = ".nuvem";
const LEGACY_CONFIG_FILE_NAME = ".nube";

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
 * Older `.nuvem` files persisted the theme reference as `installationId`.
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

/**
 * The workspace configuration used to live in `.nube`. Only a regular file is
 * migrated: other Nuvemshop projects keep a `.nube` directory at the
 * repository root.
 */
function migrateLegacyWorkspaceFile(): void {
	if (fs.existsSync(CONFIG_FILE_NAME)) {
		return;
	}

	let legacy: fs.Stats;
	try {
		legacy = fs.statSync(LEGACY_CONFIG_FILE_NAME);
	} catch {
		return;
	}
	if (!legacy.isFile()) {
		return;
	}

	try {
		fs.renameSync(LEGACY_CONFIG_FILE_NAME, CONFIG_FILE_NAME);
	} catch {
		return;
	}

	process.stderr.write(
		chalk.yellow(
			'NOTE: Your ".nube" config file has been automatically renamed to ".nuvem". The CLI now uses ".nuvem" — no action required on your end.\n',
		),
	);
}

function parseSyncFamily(value: unknown): ThemeSyncFamily | undefined {
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

	if (patch.alias !== undefined) {
		next.alias = patch.alias;
	}
	if (patch.lastSync !== undefined) {
		next.lastSync = patch.lastSync;
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
	private migrated = false;

	public constructor(private readonly configFilePath = CONFIG_FILE_NAME) {}

	/**
	 * Migrates on first access instead of on construction: every command class
	 * is instantiated on every invocation, including commands unrelated to
	 * themes.
	 */
	private ensureMigrated(): void {
		if (this.migrated) {
			return;
		}
		this.migrated = true;
		if (this.configFilePath === CONFIG_FILE_NAME) {
			migrateLegacyWorkspaceFile();
		}
	}

	IsSet(): boolean {
		this.ensureMigrated();
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
		if (typeof parsed.alias === "string" && parsed.alias.trim() !== "") {
			doc.alias = parsed.alias.trim();
		}
		const ls = parseSyncFamily(parsed.lastSync);
		if (ls !== undefined) {
			doc.lastSync = ls;
		}
		if (parsed["theme-ftp"] !== undefined) {
			doc["theme-ftp"] = parsed["theme-ftp"] as ThemeFtpConfig;
		}
		if (parsed["theme-api"] !== undefined) {
			const themeApi = parsed["theme-api"];
			doc["theme-api"] = (
				isRecord(themeApi) ? migrateLegacyThemeApiFields(themeApi) : themeApi
			) as ThemeApiWorkspaceSection;
		}
		return doc;
	}

	writeWorkspace(doc: ThemeWorkspaceDocument): void {
		this.ensureMigrated();
		const json = JSON.stringify({
			...(doc.alias !== undefined ? { alias: doc.alias } : {}),
			...(doc.lastSync !== undefined ? { lastSync: doc.lastSync } : {}),
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

	/**
	 * Points this folder at a `credentials.json` alias and drops every secret it
	 * held inline, along with any API host: a host in `.nuvem` would receive the
	 * stored token, and the folder may be an untrusted clone. Keeps which family
	 * last pulled, and the theme id unless the folder is changing store, where
	 * that id would name another store's theme.
	 */
	linkAlias(
		alias: string,
		options: { keepThemeId: boolean } = { keepThemeId: true },
	): void {
		const current = this.IsSet() ? this.readWorkspace() : {};
		const themeId = options.keepThemeId
			? current["theme-api"]?.themeId
			: undefined;
		const themeApi: ThemeApiWorkspaceSection =
			themeId !== undefined ? { themeId } : {};
		this.writeWorkspace({
			alias,
			...(current.lastSync !== undefined ? { lastSync: current.lastSync } : {}),
			...(Object.keys(themeApi).length > 0 ? { "theme-api": themeApi } : {}),
		});
	}

	TryLoadFtpConfig():
		| { success: true; config: ThemeFtpConfig }
		| { success: false; error: string } {
		try {
			if (!this.IsSet()) {
				return {
					success: false,
					error: noCredentialsError("ftp"),
				};
			}
			const doc = this.readWorkspace();
			// Resolved on the presence of the section this family needs, so a
			// workspace holding both sections serves both.
			const themeFtp = doc["theme-ftp"];
			if (themeFtp === undefined) {
				const bin = getCliExecutableName();
				return {
					success: false,
					error:
						doc["theme-api"] !== undefined
							? `This folder only has Public API credentials, and FTP commands need FTP ones.\n  → Add them: ${bin} auth ftp\n  → Or use the Public API commands: ${bin} theme pull / ${bin} theme push`
							: `Missing required "theme-ftp" key in "${this.configFilePath}". Run ${bin} auth ftp first.`,
				};
			}
			if (!isValidThemeFtpConfig(themeFtp)) {
				return {
					success: false,
					error: `Invalid "theme-ftp" configuration in "${this.configFilePath}": expected { ftp: { ftpServer, ftpUsername, ftpPassword, verbose }, storeUrl } with string and boolean fields as produced by ${getCliExecutableName()} auth ftp.`,
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
		| { success: true; config: ThemeApiConfig }
		| { success: false; error: string } {
		try {
			if (!this.IsSet()) {
				return {
					success: false,
					error: noCredentialsError("api"),
				};
			}
			const doc = this.readWorkspace();
			// Resolved on the presence of the section this family needs, so a
			// workspace holding both sections serves both.
			const themeApi = doc["theme-api"];
			if (themeApi === undefined) {
				const bin = getCliExecutableName();
				return {
					success: false,
					error:
						doc["theme-ftp"] !== undefined
							? `This folder only has FTP credentials, and this command needs Public API ones.\n  → Add them: ${bin} auth login\n  → Or use the FTP commands: ${bin} theme ftp pull / ${bin} theme ftp push`
							: `Missing required "theme-api" key in "${this.configFilePath}". Run ${bin} auth login first.`,
				};
			}
			if (!isValidThemeApiConfig(themeApi)) {
				return {
					success: false,
					error: `Invalid "theme-api" in "${this.configFilePath}": expected publicApiToken and storeId (strings) as produced by ${getCliExecutableName()} auth login.`,
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
			};
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			return {
				success: false,
				error: `Store configuration could not be loaded. ${detail}`,
			};
		}
	}

	/** Which family last pulled the local files, if it was ever recorded. */
	readLastSync(): ThemeSyncFamily | undefined {
		try {
			return this.IsSet() ? this.readWorkspace().lastSync : undefined;
		} catch {
			// An unreadable workspace is reported by the loaders; the guard that
			// consults this must not be the thing that fails.
			return undefined;
		}
	}

	/** Records the family that just wrote the local files. */
	recordLastSync(family: ThemeSyncFamily): void {
		this.mergeWorkspace({ lastSync: family });
	}
}
