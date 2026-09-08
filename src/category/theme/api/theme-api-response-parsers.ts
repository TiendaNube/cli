function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type RemoteThemeFile = {
	path: string;
	format: string;
	content: unknown;
};

export function parseGetFilesResponse(data: unknown): {
	installation: unknown;
	files: RemoteThemeFile[];
	total: number | null;
} {
	if (!isRecord(data)) {
		throw new Error("Invalid API response: expected JSON object");
	}
	if (!Array.isArray(data.files)) {
		throw new Error('Invalid API response: expected "files" array');
	}
	const files: RemoteThemeFile[] = [];
	for (const item of data.files) {
		if (!isRecord(item)) {
			continue;
		}
		const p = item.path;
		const format = item.format;
		if (typeof p !== "string" || typeof format !== "string") {
			continue;
		}
		files.push({ path: p, format, content: item.content });
	}
	const total =
		typeof data.total === "number" && Number.isFinite(data.total)
			? data.total
			: null;
	return { installation: data.installation, files, total };
}

/**
 * Single-file read. The endpoint is not used by every API version, so accept
 * the shapes it may answer with: the file object itself, `{ file: {…} }`, or a
 * one-item `{ files: [ … ] }` list.
 */
export function parseGetFileResponse(data: unknown): RemoteThemeFile {
	if (!isRecord(data)) {
		throw new Error("Invalid API response: expected JSON object");
	}
	const candidate = isRecord(data.file)
		? data.file
		: Array.isArray(data.files) && isRecord(data.files[0])
			? data.files[0]
			: data;
	const p = candidate.path;
	const format = candidate.format;
	if (typeof p !== "string" || typeof format !== "string") {
		throw new Error('Invalid API response: expected "path" and "format"');
	}
	return { path: p, format, content: candidate.content };
}

export function parseFileHashesResponse(data: unknown): Map<string, string> {
	if (!isRecord(data)) {
		throw new Error("Invalid API response: expected JSON object");
	}
	if (!isRecord(data.hashes)) {
		throw new Error('Invalid API response: expected "hashes" object');
	}
	const map = new Map<string, string>();
	for (const [path, hash] of Object.entries(data.hashes)) {
		if (typeof hash === "string") {
			map.set(path, hash);
		}
	}
	return map;
}

export function extractThemeIdFromResponse(body: unknown): string | null {
	if (!isRecord(body)) return null;
	if (body.id !== undefined) return String(body.id);
	if (body.installation_id !== undefined) return String(body.installation_id);
	return null;
}
export type UpdateTargets = {
	/** Whether the theme owns its code — decides the shape of `targets`. */
	forked: boolean;
	currentVersion: string | null;
	/** Exact versions for a forked theme, bare majors otherwise. Newest first. */
	targets: string[];
};

/**
 * Parse the `update/targets` payload. The order is the API's — newest first — and
 * is preserved rather than re-sorted here: the API knows the release order, and
 * sorting version strings client-side is how "10.0.0" ends up under "9.0.0".
 */
export function parseUpdateTargets(body: unknown): UpdateTargets {
	if (!isRecord(body)) {
		throw new Error("Invalid API response: expected JSON object");
	}
	return {
		forked: body.forked === true,
		currentVersion:
			typeof body.current_version === "string" ? body.current_version : null,
		targets: Array.isArray(body.targets)
			? body.targets.filter((v): v is string => typeof v === "string")
			: [],
	};
}

export type UpdateTestReport = {
	baselineVersion: string | null;
	targetVersion: string | null;
	/** Files whose local edits an update would discard. */
	conflictingFiles: string[];
};

/**
 * Parse the `update/test` report — the count of files whose local edits an update
 * would discard, and their paths.
 *
 * `conflicts` and `conflicting_files` must agree. The API computes both from one
 * array, so they cannot disagree at the source; if they do here, the list reaching
 * us is not the list the API sent. Deriving the count from the list instead would
 * be the dangerous reading of that: a truncated list silently under-reports, and
 * an emptied one turns into "No local edits will be lost" on the prompt that
 * authorizes an irreversible overwrite of the merchant's work. Refusing to
 * interpret a report we cannot trust is the only safe answer, and it lands before
 * the confirmation, so no draft is created.
 */
export function parseUpdateTestReport(body: unknown): UpdateTestReport {
	if (!isRecord(body)) {
		throw new Error("Invalid API response: expected JSON object");
	}

	const conflicts = body.conflicts;
	if (typeof conflicts !== "number" || !Number.isInteger(conflicts)) {
		throw new Error(
			"Invalid API response: `conflicts` must be an integer count of the files an update would overwrite",
		);
	}
	if (conflicts < 0) {
		throw new Error(
			`Invalid API response: \`conflicts\` cannot be negative (got ${conflicts})`,
		);
	}

	// A non-array is only acceptable when there is nothing to list.
	const rawFiles = Array.isArray(body.conflicting_files)
		? body.conflicting_files
		: [];
	const conflictingFiles = rawFiles.filter(
		(p): p is string => typeof p === "string",
	);

	if (conflictingFiles.length !== conflicts) {
		throw new Error(
			`Invalid API response: \`conflicts\` is ${conflicts} but ${conflictingFiles.length} usable file path(s) were returned; refusing to report an incomplete list of the files an update would overwrite`,
		);
	}

	return {
		baselineVersion:
			typeof body.baseline_version === "string" ? body.baseline_version : null,
		targetVersion:
			typeof body.target_version === "string" ? body.target_version : null,
		conflictingFiles,
	};
}

export type InstallationSummary = { id: string; isProductive: boolean };

export function parseInstallationsList(body: unknown): InstallationSummary[] {
	const items = extractInstallationsArray(body);
	const out: InstallationSummary[] = [];
	for (const item of items) {
		if (!isRecord(item)) continue;
		const rawId =
			item.id !== undefined
				? item.id
				: item.installation_id !== undefined
					? item.installation_id
					: undefined;
		if (rawId === undefined || rawId === null) continue;
		const id = String(rawId);
		if (!id) continue;
		out.push({ id, isProductive: item.is_productive === true });
	}
	return out;
}

export function extractInstallationsArray(body: unknown): unknown[] {
	if (Array.isArray(body)) {
		return body;
	}
	if (isRecord(body)) {
		if (Array.isArray(body.data)) {
			return body.data;
		}
		if (Array.isArray(body.installations)) {
			return body.installations;
		}
	}
	return [];
}

/**
 * Per EXT-518 the user-facing CLI vocabulary calls the installation's unique
 * id `theme_id`, and everything that describes the *base catalog theme* it
 * was created from carries the `base_theme*` prefix. The Public API still
 * returns the legacy shape (`installation_id`/`id`, plus `theme_id` /
 * `theme_name` / `theme_variant` / `theme_type` for the base), so rewrite
 * each item here before rendering or printing as JSON.
 */
function transformInstallationForJson(item: unknown): unknown {
	if (!isRecord(item)) {
		return item;
	}
	const {
		id,
		installation_id,
		theme_id,
		theme_name,
		theme_variant,
		theme_type,
		...rest
	} = item;
	const themeId = id ?? installation_id;
	return {
		...(themeId !== undefined ? { theme_id: themeId } : {}),
		...(theme_id !== undefined ? { base_theme_id: theme_id } : {}),
		...(theme_name !== undefined ? { base_theme: theme_name } : {}),
		...(theme_variant !== undefined
			? { base_theme_variant: theme_variant }
			: {}),
		...(theme_type !== undefined ? { base_theme_type: theme_type } : {}),
		...rest,
	};
}

/**
 * Pretty JSON for the console: `{ "themes": [ ... ] }`. Items are remapped
 * to the EXT-518 vocabulary (see `transformInstallationForJson`); the wrapper
 * key also drops the "installation" word.
 */
export function stringifyListInstallationsResponse(body: unknown): string {
	const list = extractInstallationsArray(body).map(
		transformInstallationForJson,
	);
	if (isRecord(body)) {
		const { installations, data, ...rest } = body;
		void installations;
		void data;
		return `${JSON.stringify({ ...rest, themes: list }, null, 2)}\n`;
	}
	return `${JSON.stringify({ themes: list }, null, 2)}\n`;
}

export type InstallationTableFields = {
	id: string;
	store_id: string;
	title: string;
	base_theme: string;
	base_theme_variant: string;
	theme_version: string;
	base_theme_type: string;
	is_productive: string;
	forked: string;
	archived: string;
};

export function mapInstallationToTableFields(
	item: unknown,
): InstallationTableFields {
	if (!isRecord(item)) {
		return {
			id: "?",
			store_id: "",
			title: "",
			base_theme: "",
			base_theme_variant: "N/A",
			theme_version: "N/A",
			base_theme_type: "",
			is_productive: "",
			forked: "",
			archived: "",
		};
	}
	const boolStr = (v: unknown): string => {
		if (v === true) return "yes";
		if (v === false) return "no";
		return "";
	};
	// Read the new API vocabulary first, falling back to the legacy field name
	// so the table keeps working whichever shape the Public API returns.
	const str = (...candidates: unknown[]): string => {
		for (const c of candidates) {
			if (typeof c === "string") return c;
		}
		return "";
	};
	// First non-blank value, coerced to string; `N/A` when none is present.
	const valueOrNA = (...candidates: unknown[]): string => {
		for (const c of candidates) {
			if (c != null && String(c).trim() !== "") return String(c);
		}
		return "N/A";
	};
	return {
		id:
			item.id !== undefined
				? String(item.id)
				: item.installation_id !== undefined
					? String(item.installation_id)
					: "?",
		store_id: item.store_id !== undefined ? String(item.store_id) : "",
		title: typeof item.title === "string" ? item.title : "",
		base_theme: str(item.base_theme, item.theme_name),
		base_theme_variant: valueOrNA(item.base_theme_variant, item.theme_variant),
		theme_version: valueOrNA(item.version, item.theme_version),
		base_theme_type: str(item.base_theme_type, item.theme_type),
		is_productive: boolStr(item.is_productive),
		forked: boolStr(item.forked),
		archived: boolStr(item.archived),
	};
}

function padCell(s: string, width: number): string {
	if (s.length > width) {
		return `${s.slice(0, width - 1)}…`;
	}
	return s.padEnd(width, " ");
}

/**
 * Human-readable aligned table for terminal (default `theme list` output).
 *
 * `currentId` marks the installation linked to the current folder with a ">" in
 * a leading column, so the merchant can spot it at a glance. The store id is not
 * a column — every row shares it, so the caller prints it once above the table.
 */
export function formatInstallationsAsTextTable(
	installations: unknown[],
	options: { currentId?: string } = {},
): string {
	if (installations.length === 0) {
		return "";
	}
	const rows = installations.map(mapInstallationToTableFields);
	const currentId = options.currentId?.trim();
	const marker = (r: InstallationTableFields) =>
		currentId && r.id === currentId ? ">" : "";
	const titleMax = 36;
	const cols = {
		cur: ">".length,
		id: Math.max(2, ...rows.map((r) => r.id.length), "id".length),
		title: Math.min(
			titleMax,
			Math.max(5, ...rows.map((r) => r.title.length), "title".length),
		),
		base_theme: Math.max(
			10,
			...rows.map((r) => r.base_theme.length),
			"base_theme".length,
		),
		base_theme_variant: Math.max(
			7,
			...rows.map((r) => r.base_theme_variant.length),
			"base_theme_variant".length,
		),
		theme_version: Math.max(
			7,
			...rows.map((r) => r.theme_version.length),
			"base_theme_version".length,
		),
		base_theme_type: Math.max(
			15,
			...rows.map((r) => r.base_theme_type.length),
			"base_theme_type".length,
		),
		prod: Math.max(
			4,
			...rows.map((r) => r.is_productive.length),
			"prod".length,
		),
		fork: Math.max(4, ...rows.map((r) => r.forked.length), "fork".length),
		archived: Math.max(
			8,
			...rows.map((r) => r.archived.length),
			"archived".length,
		),
	};

	// The marker sits in its own gutter, one space before `id`: "> " on the
	// current row, blank otherwise. It carries no header and no separator dashes,
	// so it reads as an annotation rather than a column.
	const gutter = (m: string) => `${padCell(m, cols.cur)} `;

	const sep = (char: string) =>
		gutter("") +
		[
			char.repeat(cols.id),
			char.repeat(cols.title),
			char.repeat(cols.base_theme),
			char.repeat(cols.base_theme_variant),
			char.repeat(cols.theme_version),
			char.repeat(cols.base_theme_type),
			char.repeat(cols.prod),
			char.repeat(cols.fork),
			char.repeat(cols.archived),
		].join("  ");

	const line = (r: InstallationTableFields) =>
		gutter(marker(r)) +
		[
			padCell(r.id, cols.id),
			padCell(r.title, cols.title),
			padCell(r.base_theme, cols.base_theme),
			padCell(r.base_theme_variant, cols.base_theme_variant),
			padCell(r.theme_version, cols.theme_version),
			padCell(r.base_theme_type, cols.base_theme_type),
			padCell(r.is_productive, cols.prod),
			padCell(r.forked, cols.fork),
			padCell(r.archived, cols.archived),
		].join("  ");

	const header =
		gutter("") +
		[
			padCell("id", cols.id),
			padCell("title", cols.title),
			padCell("base_theme", cols.base_theme),
			padCell("base_theme_variant", cols.base_theme_variant),
			padCell("base_theme_version", cols.theme_version),
			padCell("base_theme_type", cols.base_theme_type),
			padCell("prod", cols.prod),
			padCell("fork", cols.fork),
			padCell("archived", cols.archived),
		].join("  ");

	const out: string[] = [
		header,
		sep("-"),
		...rows.map(line),
		"",
		`Total: ${installations.length}`,
	];
	return `${out.join("\n")}\n`;
}
