/** Default Public API host (BR); override with `.nuvem` `theme-api.apiBaseUrl` or hidden `--api-url` on commands. */
export const DEFAULT_PUBLIC_API_BASE_URL = "https://api.nuvemshop.com.br";

/** Path segment for GET store (Public API); used by `theme authorize` to resolve storefront URL. */
export const THEME_API_STORE_RESOURCE_VERSION = "2025-03";

/** Default URL opened by `theme authorize` (CLI auth in browser). Override with hidden `--authorize-url` for internal tests. */
export const DEFAULT_THEME_AUTHORIZE_URL =
	"https://brand-editor.tiendanube.com/api/auth/cli/start";

/** Parallel theme file operations (aligned with ~2 req/s API guidance). */
export const THEME_API_MAX_PARALLEL = 2;

export const THEME_API_MAX_ATTEMPTS_FOR_REQUESTS = 6;

/** Per-request `fetch` timeout (ms). ThemeApiClient aborts the request so the call cannot hang indefinitely. */
export const THEME_API_REQUEST_TIMEOUT_MS = 120_000;

/** HTTP 429 — rate limit; ThemeApiClient reads `x-rate-limit-reset` as seconds (delta or Unix epoch) when present. */
export const THEME_API_HTTP_STATUS_TOO_MANY_REQUESTS = 429;

/** HTTP 503 — transient unavailability; ThemeApiClient retries with exponential backoff. */
export const THEME_API_HTTP_STATUS_SERVICE_UNAVAILABLE = 503;

/** Max length for error detail snippets shown in CLI (avoids huge bodies in messages). */
export const THEME_API_ERROR_DETAIL_MAX_CHARS = 400;

/** Max body size per batch PATCH request (bytes). Keeps requests under typical nginx/proxy limits. */
export const THEME_API_BATCH_MAX_BODY_BYTES = 900 * 1024;

/** Page size for the offset/limit loop in `theme pull` (API mode). */
export const THEME_API_PULL_PAGE_SIZE = 50;

/** Path prefixes (folders or exact files) included in pull/push sync. */
export const SYNC_PREFIXES = [
	"blocks",
	"config",
	"custom",
	"layouts",
	"sections",
	"snippets",
	"static",
	"templates",
	"translations",
	"manifest.json",
];

export const PUSH_UNSUPPORTED_PREFIXES = ["custom"];

export function normalizeApiBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

export function resolveThemeApiBaseUrl(options: {
	configUrl?: string;
	cliUrl?: string;
}): string {
	const fromCli = options.cliUrl?.trim();
	const fromConfig = options.configUrl?.trim();
	const raw =
		(fromCli && fromCli.length > 0 ? fromCli : null) ??
		(fromConfig && fromConfig.length > 0 ? fromConfig : null) ??
		DEFAULT_PUBLIC_API_BASE_URL;
	return normalizeApiBaseUrl(raw);
}
