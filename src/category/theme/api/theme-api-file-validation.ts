import type { ThemeApiClient, ThemeFileUpsert } from "./theme-api-client";

export type ThemeFileValidationResult = {
	/** Files the API refused; empty when every file passed. */
	invalidCount: number;
	/** The API has no validate endpoint, so nothing was checked. */
	unsupported: boolean;
};

/**
 * Asks the API to check `files` the way it would on save, and reports each
 * refused file through `onInvalid`. Shared by `theme push` (which aborts before
 * uploading anything, so a large push is never left half-applied across its
 * chunks) and `theme check` (which only reports).
 */
export async function validateThemeFiles(params: {
	client: ThemeApiClient;
	themeId: string;
	files: ThemeFileUpsert[];
	onInvalid: (line: string) => void;
}): Promise<ThemeFileValidationResult> {
	if (params.files.length === 0) {
		return { invalidCount: 0, unsupported: false };
	}
	const errors = await params.client.validateFiles(
		params.themeId,
		params.files,
	);
	if (errors === null) {
		return { invalidCount: 0, unsupported: true };
	}
	for (const e of errors) {
		params.onInvalid(`  Invalid: ${e.path} — ${e.message}`);
	}
	return { invalidCount: errors.length, unsupported: false };
}
