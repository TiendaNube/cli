const NON_FORK_PREFIXES = ["custom/", "templates/"] as const;
const NON_FORK_EXACT = ["config/settings_data.json"] as const;

/**
 * Paths that are theme "code" when the installation is not forked (cannot be pushed).
 */
export function isThemeCodeFileForNonForkedTheme(filePath: string): boolean {
	const fp = filePath.replace(/\\/g, "/");
	if (NON_FORK_PREFIXES.some((p) => fp.startsWith(p))) {
		return false;
	}
	if (NON_FORK_EXACT.includes(fp as (typeof NON_FORK_EXACT)[number])) {
		return false;
	}
	return true;
}

/** When installation is not forked, only certain paths may be uploaded. */
export function canPushRelativePathWhenNotForked(
	relativePath: string,
): boolean {
	return !isThemeCodeFileForNonForkedTheme(relativePath);
}

/** `forked === true` means full theme files may be edited remotely. */
export function isInstallationForked(installation: unknown): boolean {
	if (typeof installation !== "object" || installation === null) {
		return false;
	}
	const o = installation as Record<string, unknown>;
	return o.forked === true;
}
