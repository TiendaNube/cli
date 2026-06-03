import type { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type { ThemeApiConfig } from "../theme-workspace-types";
import { decodeCliThemeAuthToken } from "./theme-api-authorize-support";

export type ResolveApiCredentialsResult =
	| { success: true; config: ThemeApiConfig; ephemeral: boolean }
	| { success: false; error: string };

/**
 * Resolves Public API credentials either from a CLI-provided `--token` (same
 * Base64 payload produced by `theme authorize`) or from the workspace `.nuvem`
 * file. When `token` is provided, credentials are ephemeral: `.nuvem` is neither
 * read nor written for this run.
 */
export function resolveApiCredentials(params: {
	token: string | undefined;
	workspace: ThemeWorkspaceConfigManager;
}): ResolveApiCredentialsResult {
	const cliToken = params.token?.trim();
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
		};
	}

	const loaded = params.workspace.TryLoadApiConfig();
	if (!loaded.success) {
		return loaded;
	}
	return { success: true, config: loaded.config, ephemeral: false };
}
