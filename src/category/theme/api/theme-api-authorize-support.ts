import packageJson from "../../../../package.json" with { type: "json" };
import {
	THEME_API_REQUEST_TIMEOUT_MS,
	THEME_API_STORE_RESOURCE_VERSION,
	normalizeApiBaseUrl,
} from "./theme-api-constants";

export type CliAuthTokenPayload = {
	storeId: string;
	accessToken: string;
};

export type DecodeCliAuthTokenResult =
	| { ok: true; value: CliAuthTokenPayload }
	| { ok: false; message: string };

export type FetchStorefrontUrlResult =
	| { ok: true; storeUrl: string }
	| { ok: false; message: string };

function themeApiCliUserAgent(): string {
	const name = packageJson.name.replace(/^@[^/]+\//, "");
	return `${name}/${packageJson.version} (https://github.com/TiendaNube/cli)`;
}

export function ensureStorefrontProtocol(url: string): string {
	const trimmed = url.trim();
	if (!/^https?:\/\//i.test(trimmed)) {
		return `https://${trimmed}`;
	}
	return trimmed;
}

export function isHttpOrHttpsUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Reads storefront URL from Public API GET /{version}/{storeId}/store JSON.
 * Prefers `url_with_protocol`; falls back to `original_domain` with https prefix.
 */
export function extractStorefrontUrlFromStoreJson(
	body: unknown,
): string | null {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	const record = body as Record<string, unknown>;

	const withProtocol = record.url_with_protocol;
	if (typeof withProtocol === "string" && withProtocol.trim().length > 0) {
		const candidate = withProtocol.trim();
		if (isHttpOrHttpsUrl(candidate)) {
			return candidate;
		}
	}

	const original = record.original_domain;
	if (typeof original === "string" && original.trim().length > 0) {
		const candidate = ensureStorefrontProtocol(original.trim());
		if (isHttpOrHttpsUrl(candidate)) {
			return candidate;
		}
	}

	return null;
}

function parseStoreId(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const n = Math.trunc(value);
		if (n < 0) {
			return null;
		}
		return String(n);
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		return value.trim();
	}
	return null;
}

export function decodeCliThemeAuthToken(
	pasted: string,
): DecodeCliAuthTokenResult {
	const trimmed = pasted.trim();
	if (!trimmed) {
		return { ok: false, message: "Token is required." };
	}

	const utf8 = Buffer.from(trimmed, "base64").toString("utf8");

	if (!utf8.trim()) {
		return {
			ok: false,
			message:
				"Decoded token is empty. Copy the full Base64 string from the page.",
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(utf8) as unknown;
	} catch {
		return {
			ok: false,
			message:
				'Decoded content is not valid JSON. Expected {"store_id":…,"access_token":…}.',
		};
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			message: "Decoded JSON must be an object with store_id and access_token.",
		};
	}

	const obj = parsed as Record<string, unknown>;
	const storeId = parseStoreId(obj.store_id);
	const accessToken =
		typeof obj.access_token === "string" ? obj.access_token.trim() : "";

	if (!storeId) {
		return {
			ok: false,
			message: "Decoded JSON must include a numeric store_id.",
		};
	}
	if (!accessToken) {
		return {
			ok: false,
			message: "Decoded JSON must include a non-empty access_token string.",
		};
	}

	return { ok: true, value: { storeId, accessToken } };
}

function publicApiStoreUrl(apiBaseUrl: string, storeId: string): string {
	const base = normalizeApiBaseUrl(apiBaseUrl);
	return `${base}/${THEME_API_STORE_RESOURCE_VERSION}/${storeId}/store`;
}

export async function fetchStorefrontUrlFromPublicApi(options: {
	apiBaseUrl: string;
	storeId: string;
	accessToken: string;
	extraHeaders?: Record<string, string>;
	fetchFn?: typeof fetch;
}): Promise<FetchStorefrontUrlResult> {
	const fetchImpl = options.fetchFn ?? globalThis.fetch;
	const url = publicApiStoreUrl(options.apiBaseUrl, options.storeId);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, THEME_API_REQUEST_TIMEOUT_MS);

	try {
		const headers = new Headers({
			Authentication: `bearer ${options.accessToken}`,
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": themeApiCliUserAgent(),
		});
		for (const [k, v] of Object.entries(options.extraHeaders ?? {})) {
			headers.set(k, v);
		}
		const res = await fetchImpl(url, {
			method: "GET",
			signal: controller.signal,
			headers,
		});

		const text = await res.text();
		let body: unknown = text;
		if (text.length > 0) {
			try {
				body = JSON.parse(text) as unknown;
			} catch {
				body = text;
			}
		}

		if (!res.ok) {
			const snippet =
				typeof body === "object" &&
				body !== null &&
				!Array.isArray(body) &&
				typeof (body as Record<string, unknown>).message === "string"
					? String((body as Record<string, unknown>).message)
					: text.slice(0, 200);
			return {
				ok: false,
				message:
					`Could not load store from Public API (HTTP ${res.status}): ${snippet}`.trim(),
			};
		}

		const storeUrl = extractStorefrontUrlFromStoreJson(body);
		if (!storeUrl) {
			return {
				ok: false,
				message:
					"Store response did not include a usable url_with_protocol or original_domain. Check your API host and token.",
			};
		}

		return { ok: true, storeUrl };
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			return {
				ok: false,
				message: `Request to Public API timed out after ${THEME_API_REQUEST_TIMEOUT_MS}ms.`,
			};
		}
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			message: `Could not reach Public API to load store: ${msg}`,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}
