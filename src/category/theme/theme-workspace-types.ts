import { CliError } from "../../cli-action";
import { parseInstallationsList } from "./api/theme-api-response-parsers";
import type { ThemeFtpConfig } from "./ftp/theme-ftp-config";

export type ThemeManagement = "ftp" | "api";

/** Which command family last wrote the local files. */
export type ThemeSyncFamily = "ftp" | "api";

export type ThemeApiConfig = {
	publicApiToken: string;
	storeId: string;
	/** Storefront base URL (saved by `theme authorize`) for preview links. */
	storeUrl?: string;
	themeId?: string;
	apiBaseUrl?: string;
};

export type ThemeWorkspaceDocument = {
	/**
	 * Which family was configured most recently. Advisory only — the loaders
	 * resolve on the presence of the section they need, so a workspace holding
	 * both `theme-api` and `theme-ftp` can use both command families. Still
	 * written so that an older CLI, which does gate on this, keeps working.
	 */
	themeManagement?: ThemeManagement;
	/**
	 * Which family last pulled the local files. Read by the push commands to
	 * refuse uploading a tree that came from the other family.
	 */
	lastSync?: ThemeSyncFamily;
	"theme-ftp"?: ThemeFtpConfig;
	"theme-api"?: ThemeApiConfig;
};

export function resolveThemeId(
	cliThemeId: string | undefined,
	themeApi: ThemeApiConfig | undefined,
): string | null {
	const fromCli = cliThemeId?.trim();
	if (fromCli) {
		return fromCli;
	}
	const fromFile = themeApi?.themeId?.trim();
	return fromFile || null;
}

export type ProductiveThemeLookup =
	| { ok: true; id: string }
	| { ok: false; error: string };

export async function findProductiveThemeId(client: {
	listInstallations: () => Promise<unknown>;
}): Promise<ProductiveThemeLookup> {
	const body = await client.listInstallations();
	const productive = parseInstallationsList(body).filter((i) => i.isProductive);
	const [first, ...rest] = productive;
	if (!first) {
		return {
			ok: false,
			error: "No productive theme found for this store",
		};
	}
	if (rest.length > 0) {
		return {
			ok: false,
			error: `Multiple productive themes found (${productive.map((i) => i.id).join(", ")})`,
		};
	}
	return { ok: true, id: first.id };
}

/**
 * Resolves the theme id, consulting the productive theme when `--published` is
 * set. Throws `CliError` on `--published`-specific failures (bad combo, no/many
 * productive themes, listing failure). Returns `null` only when nothing is
 * resolvable yet in the non-published path, so callers may prompt as a fallback.
 */
export async function resolveThemeIdWithProductive(args: {
	options: { themeId?: string; published?: boolean };
	config: ThemeApiConfig | undefined;
	getClient: () => { listInstallations: () => Promise<unknown> };
}): Promise<string | null> {
	const { options, config, getClient } = args;
	if (options.published && options.themeId) {
		throw new CliError("--published cannot be combined with --theme-id");
	}
	if (options.published) {
		let found: ProductiveThemeLookup;
		try {
			found = await findProductiveThemeId(getClient());
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new CliError(`Failed to list themes: ${msg}`);
		}
		if (!found.ok) {
			throw new CliError(found.error);
		}
		return found.id;
	}
	return resolveThemeId(options.themeId, config);
}
