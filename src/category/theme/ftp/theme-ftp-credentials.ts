import {
	type CredentialSource,
	defaultAliasForFolder,
	identityForAlias,
	noCredentialsError,
	selectRunAlias,
	unreadableWorkspaceError,
} from "../../auth/domain/auth-credential-source";
import { migrateLegacyWorkspaceCredentials } from "../../auth/domain/auth-legacy-migration";
import { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import type { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type { ThemeWorkspaceDocument } from "../theme-workspace-types";
import type { ThemeFtpConfig } from "./theme-ftp-config";

export type ResolveFtpCredentialsResult =
	| {
			success: true;
			config: ThemeFtpConfig;
			source: CredentialSource;
			alias?: string;
	  }
	| { success: false; error: string };

/**
 * Resolves the FTP login for one run: `--alias`, the alias environment
 * variable, the alias `.nuvem` is linked to, legacy credentials held inline
 * in `.nuvem` (migrated to `credentials.json` on the way), then the stored
 * default for a folder that names no credential of its own. There is
 * deliberately no ephemeral password flag.
 */
export function resolveFtpCredentials(params: {
	alias?: string;
	workspace: ThemeWorkspaceConfigManager;
	store?: AuthCredentialsStore;
	env?: Record<string, string | undefined>;
}): ResolveFtpCredentialsResult {
	const selected = selectRunAlias({ flagAlias: params.alias, env: params.env });
	if (!selected.ok) {
		return { success: false, error: selected.error };
	}

	let doc: ThemeWorkspaceDocument = {};
	try {
		doc = params.workspace.IsSet() ? params.workspace.readWorkspace() : {};
	} catch (cause) {
		if (selected.alias === undefined) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			return {
				success: false,
				error: unreadableWorkspaceError(detail),
			};
		}
	}
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
			found = identityForAlias({ store, alias, source, kind: "ftp" });
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
		const ftp = found.identity.tokens.ftp;
		if (ftp === undefined) {
			return { success: false, error: noCredentialsError("ftp") };
		}
		store.touch(alias);
		return {
			success: true,
			config: {
				ftp: {
					ftpServer: ftp.server,
					ftpUsername: ftp.username,
					ftpPassword: ftp.password,
					verbose: false,
				},
				storeUrl: found.identity.data.storeUrl ?? "",
			},
			source,
			alias,
		};
	}

	if (!params.workspace.IsSet()) {
		return { success: false, error: noCredentialsError("ftp") };
	}
	const loaded = params.workspace.TryLoadFtpConfig();
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
		source:
			migratedAlias !== undefined ? "workspace-alias" : "workspace-inline",
		...(migratedAlias !== undefined ? { alias: migratedAlias } : {}),
	};
}
