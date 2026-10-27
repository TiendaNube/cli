import type { Identity } from "./auth-credentials-types";

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

const FALLBACK_ALIAS = "store";

/** Returns an error message, or `undefined` when the alias is acceptable. */
export function validateAlias(value: string): string | undefined {
	if (ALIAS_PATTERN.test(value.trim())) {
		return undefined;
	}
	return 'Use up to 63 lowercase letters, digits, ".", "-" or "_", starting with a letter or digit (for example: my-store).';
}

/** `validateAlias` for a flag value: the message also names the value that was refused. */
export function validateAliasFlag(value: string): string | undefined {
	const error = validateAlias(value);
	return error === undefined
		? undefined
		: `"${value}" can't be used as an alias. ${error}`;
}

export function normalizeAlias(value: string): string {
	return value.trim();
}

/** Lowercased hostname of a storefront URL, with or without a scheme. */
export function storefrontHost(url: string | undefined): string | undefined {
	const trimmed = url?.trim();
	if (!trimmed) {
		return undefined;
	}
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		const host = new URL(withScheme).hostname.toLowerCase();
		return host === "" ? undefined : host;
	} catch {
		return undefined;
	}
}

function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[^a-z0-9]+/, "")
		.slice(0, 63)
		.replace(/[._-]+$/, "");
}

/**
 * First label of the host (`acme.lojavirtualnuvem.com.br` → `acme`). The
 * platform-assigned `original_domain` is the preferred input because it
 * survives the merchant changing a custom domain.
 */
export function deriveAliasFromHost(host: string | undefined): string {
	const label = host?.replace(/^www\./, "").split(".")[0] ?? "";
	const slug = slugify(label);
	return slug === "" ? FALLBACK_ALIAS : slug;
}

/** `base`, or `base-2`, `base-3`… — whichever is not taken yet. */
export function uniqueAlias(base: string, identities: Identity[]): string {
	const taken = new Set(identities.map((identity) => identity.alias));
	if (!taken.has(base)) {
		return base;
	}
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}
