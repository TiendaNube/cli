import { Chalk } from "chalk";
import type { ThemeWorkspaceConfigManager } from "../../theme/theme-workspace-config-manager";
import type { AuthCredentialsStore } from "../infra/auth-credentials-store";
import { deriveAliasFromHost, storefrontHost, uniqueAlias } from "./auth-alias";
import type { FtpToken, StoreIdentity } from "./auth-credentials-types";

const chalk = new Chalk();

function sameFtpLogin(stored: FtpToken | undefined, legacy: FtpToken): boolean {
	return (
		stored !== undefined &&
		stored.server === legacy.server &&
		stored.username === legacy.username &&
		stored.password === legacy.password
	);
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: undefined;
}

/**
 * Moves the secrets a legacy `.nuvem` holds inline into `credentials.json`
 * and leaves the folder pointing at an alias. An entry that already covers
 * the file is reused unchanged; otherwise a new entry is created. A stored
 * credential is never modified, because the folder may be an untrusted clone.
 *
 * Never fails the command that triggered it: on any error — a read-only disk,
 * a locked or invalid credentials file — the folder is left untouched and the
 * caller keeps using the inline credential. Returns the alias on success.
 */
export function migrateLegacyWorkspaceCredentials(
	workspace: ThemeWorkspaceConfigManager,
	store: AuthCredentialsStore,
	now: Date = new Date(),
): string | undefined {
	try {
		const doc = workspace.readWorkspace();
		if (doc.alias !== undefined) {
			return undefined;
		}

		const section = doc["theme-api"];
		const accessToken = nonEmpty(section?.publicApiToken);
		const storeId = nonEmpty(section?.storeId);
		const api = accessToken && storeId ? { accessToken, storeId } : undefined;

		const legacyFtp = doc["theme-ftp"];
		const ftpServer = nonEmpty(legacyFtp?.ftp?.ftpServer);
		const ftp =
			ftpServer &&
			typeof legacyFtp?.ftp?.ftpUsername === "string" &&
			typeof legacyFtp.ftp.ftpPassword === "string"
				? {
						server: ftpServer,
						username: legacyFtp.ftp.ftpUsername,
						password: legacyFtp.ftp.ftpPassword,
					}
				: undefined;

		if (api === undefined && ftp === undefined) {
			return undefined;
		}

		const apiStoreUrl = nonEmpty(section?.storeUrl);
		const ftpStoreUrl = nonEmpty(legacyFtp?.storeUrl);
		const storeUrl = apiStoreUrl ?? ftpStoreUrl;
		const host = storefrontHost(storeUrl);

		const identities = store.list();
		// A legacy file never changes a credential that is already stored: the
		// folder may be an untrusted clone, so it can only reuse an entry that
		// already covers it (the same store for API, an identical login for FTP)
		// or add a brand new one.
		const covering = identities.find(
			(entry) =>
				(api === undefined ||
					(entry.data.storeId === api.storeId &&
						entry.tokens.api !== undefined)) &&
				(ftp === undefined || sameFtpLogin(entry.tokens.ftp, ftp)),
		);

		const alias =
			covering?.alias ??
			uniqueAlias(
				host !== undefined
					? deriveAliasFromHost(host)
					: `store-${api?.storeId ?? "ftp"}`,
				identities,
			);

		if (covering === undefined) {
			// Token and host come from the same file here, so the host is as
			// trustworthy as the token it is stored with.
			const apiBaseUrl = nonEmpty(section?.apiBaseUrl);
			const next: StoreIdentity = {
				alias,
				type: "store",
				createdAt: now.toISOString(),
				data: {
					...(api !== undefined ? { storeId: api.storeId } : {}),
					...(storeUrl !== undefined ? { storeUrl } : {}),
				},
				tokens: {
					...(api !== undefined
						? {
								api: {
									accessToken: api.accessToken,
									...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
								},
							}
						: {}),
					...(ftp !== undefined ? { ftp } : {}),
				},
			};
			store.put(next);

			// Only rewrite the folder once the secret is provably in the store: this
			// is the one moment the only copy of a token could be lost.
			const stored = store.get(alias);
			if (
				stored === undefined ||
				(api !== undefined &&
					stored.tokens.api?.accessToken !== api.accessToken) ||
				(ftp !== undefined && !sameFtpLogin(stored.tokens.ftp, ftp))
			) {
				return undefined;
			}
		}

		workspace.linkAlias(alias);

		process.stderr.write(
			chalk.yellow(
				covering === undefined
					? `NOTE: The credentials stored in ".nuvem" were moved to ${store.FilePath} under the alias "${alias}". This folder now refers to that alias — no action required on your end.\n`
					: `NOTE: This folder now uses the credential "${alias}" already stored on this machine, and the copy inside ".nuvem" was removed — no action required on your end.\n`,
			),
		);
		return alias;
	} catch {
		return undefined;
	}
}
