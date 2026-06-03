import { THEME_API_ERROR_DETAIL_MAX_CHARS } from "./theme-api-constants";

/** Stable error codes returned by the Theme Installations API. */
export type ThemeApiErrorCode =
	| "NOT_FOUND"
	| "BAD_REQUEST"
	| "UPSTREAM_ERROR"
	| "INTERNAL_ERROR"
	| "INSTALLATION_LIMIT_EXCEEDED"
	| "REVISION_TOKEN_MISMATCH"
	| "THEME_NOT_SECTIONABLE"
	| "FILE_PATH_NOT_ALLOWED_WITHOUT_FORK"
	| "FILE_LIMIT_EXCEEDED"
	| "INSTALLATION_ALREADY_FORKED"
	| "CANNOT_DELETE_PRODUCTIVE_INSTALLATION"
	| "NO_PRODUCTIVE_INSTALLATION"
	| "PRODUCTIVE_INSTALLATION_EXISTS"
	| "INVALID_THEME_CODE";

/** Code-driven hints rendered in place of the API `message`. Add one line here per friendly override. */
const THEME_API_CODE_HINTS: Partial<Record<ThemeApiErrorCode, string>> = {
	THEME_NOT_SECTIONABLE:
		"Only sectionable themes support this operation. Check theme_type in theme list.",
	INSTALLATION_ALREADY_FORKED: "This installation is already forked.",
	FILE_PATH_NOT_ALLOWED_WITHOUT_FORK:
		"This file can only be modified in forked installations. Run 'theme fork' to perform this action.",
};

function isThemeApiResponseLikelyHtml(
	contentType: string | null,
	text: string,
): boolean {
	const ct = contentType?.toLowerCase() ?? "";
	if (ct.includes("text/html")) {
		return true;
	}
	const start = text.trimStart().slice(0, 32).toLowerCase();
	return (
		start.startsWith("<!doctype html") ||
		start.startsWith("<html") ||
		start.startsWith("<head") ||
		start.startsWith("<body")
	);
}

function sanitizeThemeApiErrorPlainText(text: string): string {
	let noControls = "";
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		const ch = text.charAt(i);
		noControls += code < 32 || code === 127 ? " " : ch;
	}
	return noControls.replace(/\s+/g, " ").trim();
}

function truncateThemeApiErrorDetail(text: string): string {
	const max = THEME_API_ERROR_DETAIL_MAX_CHARS;
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max)} … [truncated]`;
}

/** Pulls the `code` and the human-readable `message` out of a failed response body. */
export function extractThemeApiCodeAndMessage(
	body: unknown,
	text: string,
	contentType: string | null,
): { code: string | null; message: string } {
	if (isThemeApiResponseLikelyHtml(contentType, text)) {
		return {
			code: null,
			message:
				"Response was HTML or non-API content (often a proxy or CDN error). Check API URL and network.",
		};
	}

	if (body !== null && typeof body === "object" && !Array.isArray(body)) {
		const record = body as Record<string, unknown>;
		const fromMessage =
			typeof record.message === "string" ? record.message : "";
		const fromError = typeof record.error === "string" ? record.error : "";
		const code = typeof record.code === "string" ? record.code : null;
		const apiLine = fromMessage || fromError;
		if (apiLine.length > 0) {
			return {
				code,
				message: truncateThemeApiErrorDetail(
					sanitizeThemeApiErrorPlainText(apiLine),
				),
			};
		}
		if (code) {
			return { code, message: "(no message)" };
		}
	}

	const plain = sanitizeThemeApiErrorPlainText(text);
	if (plain.length === 0) {
		return { code: null, message: "Empty response body." };
	}
	return { code: null, message: truncateThemeApiErrorDetail(plain) };
}

export type ThemeApiErrorInit = {
	operation: string;
	status: number;
	code: string | null;
	apiMessage: string;
	body: unknown;
};

/**
 * Structured error thrown by ThemeApiClient on HTTP failure. Preserves the API's
 * `code` (stable, branchable) and `apiMessage` (debug, unstable) alongside the
 * formatted `.message` already used by command-level loggers.
 */
export class ThemeApiError extends Error {
	readonly operation: string;
	readonly status: number;
	readonly code: string | null;
	readonly apiMessage: string;
	readonly body: unknown;

	constructor(init: ThemeApiErrorInit) {
		const hint = init.code
			? THEME_API_CODE_HINTS[init.code as ThemeApiErrorCode]
			: undefined;
		const detail = hint ?? init.apiMessage;
		super(`${init.operation} failed (HTTP ${init.status}): ${detail}`);
		this.name = "ThemeApiError";
		this.operation = init.operation;
		this.status = init.status;
		this.code = init.code;
		this.apiMessage = init.apiMessage;
		this.body = init.body;
	}
}
