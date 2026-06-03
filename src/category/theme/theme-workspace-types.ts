import { parseInstallationsList } from "./api/theme-api-response-parsers";
import type { ThemeFtpConfig } from "./ftp/theme-ftp-config";

export type ThemeManagement = "ftp" | "api";

export type ThemeApiConfig = {
	publicApiToken: string;
	storeId: string;
	/** Storefront base URL (saved by `theme authorize`) for preview links. */
	storeUrl?: string;
	themeId?: string;
	apiBaseUrl?: string;
};

export type ThemeWorkspaceDocument = {
	themeManagement?: ThemeManagement;
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

export async function resolveThemeIdWithProductive(args: {
	options: { themeId?: string; published?: boolean };
	config: ThemeApiConfig | undefined;
	getClient: () => { listInstallations: () => Promise<unknown> };
	logger: { Error: (msg: string) => void };
}): Promise<string | null> {
	const { options, config, getClient, logger } = args;
	if (options.published && options.themeId) {
		logger.Error("--published cannot be combined with --theme-id");
		return null;
	}
	if (options.published) {
		try {
			const found = await findProductiveThemeId(getClient());
			if (!found.ok) {
				logger.Error(found.error);
				return null;
			}
			return found.id;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.Error(`Failed to list themes: ${msg}`);
			return null;
		}
	}
	return resolveThemeId(options.themeId, config);
}
