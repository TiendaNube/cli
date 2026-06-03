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
	theme_version: string;
	base_theme_type: string;
	is_productive: string;
	forked: string;
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
			theme_version: "",
			base_theme_type: "",
			is_productive: "",
			forked: "",
		};
	}
	const boolStr = (v: unknown): string => {
		if (v === true) return "yes";
		if (v === false) return "no";
		return "";
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
		base_theme: typeof item.theme_name === "string" ? item.theme_name : "",
		theme_version:
			item.theme_version !== undefined ? String(item.theme_version) : "",
		base_theme_type: typeof item.theme_type === "string" ? item.theme_type : "",
		is_productive: boolStr(item.is_productive),
		forked: boolStr(item.forked),
	};
}

function padCell(s: string, width: number): string {
	if (s.length > width) {
		return `${s.slice(0, width - 1)}…`;
	}
	return s.padEnd(width, " ");
}

/** Human-readable aligned table for terminal (default `theme list` output). */
export function formatInstallationsAsTextTable(
	installations: unknown[],
): string {
	if (installations.length === 0) {
		return "";
	}
	const rows = installations.map(mapInstallationToTableFields);
	const titleMax = 36;
	const cols = {
		id: Math.max(2, ...rows.map((r) => r.id.length), "id".length),
		store_id: Math.max(
			8,
			...rows.map((r) => r.store_id.length),
			"store_id".length,
		),
		title: Math.min(
			titleMax,
			Math.max(5, ...rows.map((r) => r.title.length), "title".length),
		),
		base_theme: Math.max(
			10,
			...rows.map((r) => r.base_theme.length),
			"base_theme".length,
		),
		theme_version: Math.max(
			7,
			...rows.map((r) => r.theme_version.length),
			"version".length,
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
	};

	const sep = (char: string) =>
		[
			char.repeat(cols.id),
			char.repeat(cols.store_id),
			char.repeat(cols.title),
			char.repeat(cols.base_theme),
			char.repeat(cols.theme_version),
			char.repeat(cols.base_theme_type),
			char.repeat(cols.prod),
			char.repeat(cols.fork),
		].join("  ");

	const line = (r: InstallationTableFields) =>
		[
			padCell(r.id, cols.id),
			padCell(r.store_id, cols.store_id),
			padCell(r.title, cols.title),
			padCell(r.base_theme, cols.base_theme),
			padCell(r.theme_version, cols.theme_version),
			padCell(r.base_theme_type, cols.base_theme_type),
			padCell(r.is_productive, cols.prod),
			padCell(r.forked, cols.fork),
		].join("  ");

	const header = [
		padCell("id", cols.id),
		padCell("store_id", cols.store_id),
		padCell("title", cols.title),
		padCell("base_theme", cols.base_theme),
		padCell("version", cols.theme_version),
		padCell("base_theme_type", cols.base_theme_type),
		padCell("prod", cols.prod),
		padCell("fork", cols.fork),
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
