/** Query parameter used by the storefront to preview a theme installation. */
export const THEME_INSTALLATION_PREVIEW_QUERY = "theme_installation_id";

/**
 * Builds a storefront preview URL: `{storeUrl}?theme_installation_id={id}` (merges with existing query).
 */
export function buildThemeInstallationPreviewUrl(
	storeUrl: string,
	installationId: string,
): string {
	const trimmed = storeUrl.trim();
	const id = installationId.trim();
	if (!id) {
		throw new Error("installation id must be non-empty.");
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(
			"store_url must be a valid absolute URL including the scheme (e.g. https://your-store.example.com).",
		);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`store_url must use http or https (got ${url.protocol}).`);
	}
	url.searchParams.set(THEME_INSTALLATION_PREVIEW_QUERY, id);
	return url.toString();
}
