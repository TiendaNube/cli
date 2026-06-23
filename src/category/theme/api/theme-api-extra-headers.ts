import { CliError } from "../../../cli-action";
import type { CliLogger } from "../../../cli-logger";

/**
 * Parses repeated `--header "Key: Value"` CLI inputs into a header record.
 * Later entries override earlier ones case-insensitively (matches `fetch` Headers semantics).
 * Throws on malformed entries (missing colon, empty key).
 * Returns `authOverridden: true` when any entry sets `Authentication` so callers can warn.
 */
export type ParsedExtraHeaders = {
	headers: Record<string, string>;
	authOverridden: boolean;
};

export function parseExtraHeaderEntries(entries: string[]): ParsedExtraHeaders {
	const headers: Record<string, string> = {};
	const lowercaseKeyToOriginalKey = new Map<string, string>();
	let authOverridden = false;

	for (const raw of entries) {
		const colonIndex = raw.indexOf(":");
		if (colonIndex <= 0) {
			throw new Error(
				`Invalid --header value "${raw}": expected "Key: Value" with a non-empty key.`,
			);
		}
		const key = raw.slice(0, colonIndex).trim();
		const value = raw.slice(colonIndex + 1).trim();
		if (key.length === 0) {
			throw new Error(
				`Invalid --header value "${raw}": header key must be non-empty.`,
			);
		}
		const lower = key.toLowerCase();
		if (lower === "authentication") {
			authOverridden = true;
		}
		const existing = lowercaseKeyToOriginalKey.get(lower);
		if (existing !== undefined) {
			delete headers[existing];
		}
		headers[key] = value;
		lowercaseKeyToOriginalKey.set(lower, key);
	}

	return { headers, authOverridden };
}

/**
 * Parses `--header` CLI input, warns on stderr when Authentication is overridden,
 * and throws `CliError` on malformed input. Returns a (possibly empty) header map.
 */
export function resolveExtraHeadersFromCli(
	raw: string[] | undefined,
	logger: CliLogger,
): Record<string, string> {
	if (!raw || raw.length === 0) {
		return {};
	}
	let parsed: ParsedExtraHeaders;
	try {
		parsed = parseExtraHeaderEntries(raw);
	} catch (err) {
		throw new CliError(err instanceof Error ? err.message : String(err));
	}
	if (parsed.authOverridden) {
		logger.Warn(
			"--header overrides Authentication; the configured public API token will not be sent. Tokens passed via --header may appear in shell history and process listings.",
		);
	}
	return parsed.headers;
}
