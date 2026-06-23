import type {
	PromptNormalizer,
	PromptValidator,
} from "../../../prompt-validation";
import {
	ensureStorefrontProtocol,
	isHttpOrHttpsUrl,
} from "../api/theme-api-authorize-support";

/** Prefix `https://` when the user omits the protocol. */
export const normalizeStoreUrl: PromptNormalizer = (value) =>
	ensureStorefrontProtocol(value.trim());

/** Accept anything that normalizes to a valid http/https URL. */
export const validateStoreUrl: PromptValidator = (value) =>
	isHttpOrHttpsUrl(normalizeStoreUrl(value))
		? undefined
		: "Enter a valid URL (e.g. https://your-store.lojavirtualnuvem.com.br).";

/** Strip protocol/path from a pasted URL, keeping just `host[:port]`. */
export const normalizeFtpServer: PromptNormalizer = (value) => {
	const trimmed = value.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			return url.port ? `${url.hostname}:${url.port}` : url.hostname;
		} catch {
			// fall through to path-stripping below
		}
	}
	return trimmed.replace(/\/.*$/, "");
};
