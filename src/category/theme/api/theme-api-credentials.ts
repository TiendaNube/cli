import {
	type CredentialSource,
	defaultAliasForFolder,
	identityForAlias,
	noCredentialsError,
	selectRunAlias,
	tokenWithAliasError,
	unreadableWorkspaceError,
} from "../../auth/domain/auth-credential-source";
import { migrateLegacyWorkspaceCredentials } from "../../auth/domain/auth-legacy-migration";
import { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import type { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type {
	ThemeApiConfig,
	ThemeWorkspaceDocument,
} from "../theme-workspace-types";
import { decodeCliThemeAuthToken } from "./theme-api-authorize-support";

export type ResolveApiCredentialsResult =
	| {
			success: true;
			config: ThemeApiConfig;
			/** True when the credential is not this folder's own: `.nuvem` must not be written. */
			ephemeral: boolean;
			source: CredentialSource;
			alias?: string;
	  }
	| { success: false; error: string };

function readWorkspaceOrError(
	workspace: ThemeWorkspaceConfigManager,
): { ok: true; doc: ThemeWorkspaceDocument } | { ok: false; error: string } {
	try {
		return {
			ok: true,
			doc: workspace.IsSet() ? workspace.readWorkspace() : {},
		};
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		return {
			ok: false,
			error: unreadableWorkspaceError(detail),
		};
	}
}

/**
 * Resolves the Public API credential for one run, highest precedence first:
 * `--token` (ephemeral, touches no file), `--alias`, the alias environment
 * variable, the alias `.nuvem` is linked to, a legacy token held inline in
 * `.nuvem` — which is migrated to `credentials.json` on the way — and finally
 * the stored default, for a folder that names no credential of its own.
 * `--token` together with `--alias` is an error, because one of the two is a
 * mistake and guessing which runs against the wrong store; `--token` with the
 * alias environment variable is not, since the variable is ambient.
 */
export function resolveApiCredentials(params: {
	token: string | undefined;
	alias?: string;
	workspace: ThemeWorkspaceConfigManager;
	store?: AuthCredentialsStore;
	env?: Record<string, string | undefined>;
}): ResolveApiCredentialsResult {
	const cliToken = params.token?.trim();
	if (cliToken && params.alias?.trim()) {
		return { success: false, error: tokenWithAliasError() };
	}
	if (cliToken) {
		const decoded = decodeCliThemeAuthToken(cliToken);
		if (!decoded.ok) {
			return { success: false, error: `Invalid --token: ${decoded.message}` };
		}
		return {
			success: true,
			config: {
				publicApiToken: decoded.value.accessToken,
				storeId: decoded.value.storeId,
			},
			ephemeral: true,
			source: "token",
		};
	}

	const selected = selectRunAlias({ flagAlias: params.alias, env: params.env });
	if (!selected.ok) {
		return { success: false, error: selected.error };
	}

	const read = readWorkspaceOrError(params.workspace);
	if (!read.ok && selected.alias === undefined) {
		return { success: false, error: read.error };
	}
	const doc = read.ok ? read.doc : {};
	const store = params.store ?? new AuthCredentialsStore();

	let alias: string | undefined;
	let source: "alias-flag" | "env" | "workspace-alias" | "default";
	let found: ReturnType<typeof identityForAlias> | undefined;
	try {
		alias = selected.alias ?? doc.alias ?? defaultAliasForFolder(store, doc);
		source =
			selected.source ??
			(doc.alias !== undefined ? "workspace-alias" : "default");
		if (alias !== undefined) {
			found = identityForAlias({ store, alias, source, kind: "api" });
		}
	} catch (cause) {
		return {
			success: false,
			error: cause instanceof Error ? cause.message : String(cause),
		};
	}
	if (alias !== undefined && found !== undefined) {
		if (!found.ok) {
			return { success: false, error: found.error };
		}
		const { identity } = found;
		const api = identity.tokens.api;
		const storeId = identity.data.storeId;
		if (api === undefined || storeId === undefined) {
			return { success: false, error: noCredentialsError("api") };
		}

		// The folder's theme id only applies to the store the folder is linked to;
		// selecting another alias for this run must not borrow it.
		const folderOwnsCredential = doc.alias === alias;
		const section = folderOwnsCredential ? doc["theme-api"] : undefined;
		// The host comes only from the credential (or --api-url, applied by the
		// caller), never from .nuvem: a cloned folder is untrusted input, and a host
		// it names would receive this stored token.
		const apiBaseUrl = api.apiBaseUrl?.trim();
		const themeId = section?.themeId?.trim();
		store.touch(alias);
		return {
			success: true,
			config: {
				publicApiToken: api.accessToken.trim(),
				storeId,
				...(identity.data.storeUrl ? { storeUrl: identity.data.storeUrl } : {}),
				...(themeId ? { themeId } : {}),
				...(apiBaseUrl ? { apiBaseUrl: apiBaseUrl.replace(/\/+$/, "") } : {}),
			},
			ephemeral: !folderOwnsCredential,
			source,
			alias,
		};
	}

	const loaded = params.workspace.TryLoadApiConfig();
	if (!loaded.success) {
		return loaded;
	}
	const migratedAlias = migrateLegacyWorkspaceCredentials(
		params.workspace,
		store,
	);
	return {
		success: true,
		config: loaded.config,
		ephemeral: false,
		source:
			migratedAlias !== undefined ? "workspace-alias" : "workspace-inline",
		...(migratedAlias !== undefined ? { alias: migratedAlias } : {}),
	};
}
