import { type ThemeApiClient, mapPool } from "./theme-api-client";
import {
	THEME_API_MAX_PARALLEL,
	THEME_API_PULL_PAGE_SIZE,
} from "./theme-api-constants";
import { ThemeApiError } from "./theme-api-error";
import {
	type RemoteThemeFile,
	parseGetFileResponse,
	parseGetFilesResponse,
} from "./theme-api-response-parsers";

/**
 * Statuses that mean "this API version has no single-file read endpoint" rather
 * than "that file does not exist", so callers fall back to full pagination.
 */
const UNSUPPORTED_ENDPOINT_STATUSES = new Set([400, 404, 405, 406, 415, 501]);

/**
 * Downloads every remote file (content included), paging through the API. Used
 * by `theme pull` and as the fallback of `fetchRemoteContents`.
 */
export async function fetchAllRemoteFiles(
	client: ThemeApiClient,
	themeId: string,
): Promise<{ installation: unknown; files: RemoteThemeFile[] }> {
	const limit = THEME_API_PULL_PAGE_SIZE;
	const fetchPage = async (
		off: number,
	): Promise<ReturnType<typeof parseGetFilesResponse>> => {
		const raw = await client.getFiles(themeId, { offset: off, limit });
		return parseGetFilesResponse(raw);
	};

	const firstPage = await fetchPage(0);
	const installation: unknown = firstPage.installation;
	const total = firstPage.total;
	const files: RemoteThemeFile[] = [...firstPage.files];

	if (total !== null) {
		// Parallel path: `total` known, fan out the remaining offsets within
		// the shared API concurrency budget.
		const remainingOffsets: number[] = [];
		for (let off = limit; off < total; off += limit) {
			remainingOffsets.push(off);
		}
		if (remainingOffsets.length > 0) {
			const pages = await mapPool(
				remainingOffsets,
				THEME_API_MAX_PARALLEL,
				(off) => fetchPage(off),
			);
			for (const page of pages) {
				files.push(...page.files);
			}
		}
	} else if (firstPage.files.length >= limit) {
		// Sequential fallback: no `total`, iterate until a short page.
		let off = limit;
		for (;;) {
			const page = await fetchPage(off);
			files.push(...page.files);
			if (page.files.length < limit) {
				break;
			}
			off += limit;
		}
	}

	return { installation, files };
}

export type RemoteContentsResult = {
	/** Remote files keyed by theme-relative path. */
	files: Map<string, RemoteThemeFile>;
	/** Requested paths whose content could not be retrieved, with the reason. */
	unavailable: Map<string, string>;
};

/**
 * Fetches the remote content of specific paths. Tries the cheap single-file
 * endpoint first and falls back to downloading every file when the API does not
 * expose it.
 */
export async function fetchRemoteContents(
	client: ThemeApiClient,
	themeId: string,
	paths: string[],
	options: { onNotice?: (message: string) => void } = {},
): Promise<RemoteContentsResult> {
	const notice = options.onNotice ?? ((): void => {});
	const files = new Map<string, RemoteThemeFile>();
	const unavailable = new Map<string, string>();
	if (paths.length === 0) {
		return { files, unavailable };
	}

	const [probePath, ...restPaths] = paths;
	if (probePath === undefined) {
		return { files, unavailable };
	}

	try {
		files.set(
			probePath,
			parseGetFileResponse(await client.getFile(themeId, probePath)),
		);
	} catch (err) {
		if (
			err instanceof ThemeApiError &&
			UNSUPPORTED_ENDPOINT_STATUSES.has(err.status)
		) {
			notice(
				"  Single-file read unavailable, downloading the full theme to build the diff…",
			);
			const all = await fetchAllRemoteFiles(client, themeId);
			const byPath = new Map(all.files.map((f) => [f.path, f]));
			for (const p of paths) {
				const found = byPath.get(p);
				if (found) {
					files.set(p, found);
				} else {
					unavailable.set(p, "not found in the remote theme");
				}
			}
			return { files, unavailable };
		}
		unavailable.set(
			probePath,
			err instanceof Error ? err.message : String(err),
		);
	}

	if (restPaths.length > 0) {
		await mapPool(restPaths, THEME_API_MAX_PARALLEL, async (p) => {
			try {
				files.set(p, parseGetFileResponse(await client.getFile(themeId, p)));
			} catch (err) {
				unavailable.set(p, err instanceof Error ? err.message : String(err));
			}
			return null;
		});
	}

	return { files, unavailable };
}
