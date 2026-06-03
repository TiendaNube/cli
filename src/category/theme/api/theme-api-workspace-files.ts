import fs from "node:fs";
import path from "node:path";

function isHiddenSegment(segment: string): boolean {
	return (
		segment.length > 0 &&
		segment.startsWith(".") &&
		segment !== "." &&
		segment !== ".."
	);
}

/**
 * Whether a path inside the theme workspace contains a hidden segment
 * (e.g. `.nuvem`, `.git`, `foo/.bar/baz`) — those are not part of the theme
 * content exchanged with the API.
 */
export function isHiddenWorkspacePath(relativePath: string): boolean {
	const normalized = path.normalize(relativePath);
	return normalized
		.split(/[/\\]/)
		.filter((s) => s.length > 0)
		.some(isHiddenSegment);
}

/** Top-level entries in `root` that count as theme content (non-hidden). */
export function listThemeEntries(root: string): string[] {
	return fs.readdirSync(root).filter((name) => !isHiddenWorkspacePath(name));
}

/**
 * Removes the given top-level entries from `root`. Pass only names obtained via
 * `listThemeEntries` so hidden entries (`.nuvem`, `.git`, …) are never touched.
 */
export function cleanThemeWorkspace(root: string, entries: string[]): void {
	for (const name of entries) {
		fs.rmSync(path.join(root, name), { recursive: true, force: true });
	}
}

/**
 * When `absolutePath` is missing (e.g. after unlink), walk up to the nearest
 * existing ancestor, resolve its real path, then append the removed suffix so
 * the result matches the path the theme would have used if the file still existed.
 */
function realpathReconstructFromExistingAncestors(
	absolutePath: string,
): string {
	let walkDir = path.resolve(absolutePath);
	const missingSuffix: string[] = [];

	for (;;) {
		if (fs.existsSync(walkDir)) {
			try {
				const existingReal = fs.realpathSync.native(walkDir);
				return missingSuffix.length === 0
					? existingReal
					: path.join(existingReal, ...missingSuffix);
			} catch {
				// e.g. permission; keep walking up
			}
		}
		const parentDir = path.dirname(walkDir);
		if (parentDir === walkDir) {
			return path.normalize(absolutePath);
		}
		missingSuffix.unshift(path.basename(walkDir));
		walkDir = parentDir;
	}
}

/**
 * Theme-relative path from `themeRoot`, resolving symlink/realpath mismatches
 * between cwd and paths emitted by the file watcher.
 */
export function relativeToThemeRoot(
	themeRoot: string,
	filePath: string,
): string {
	const rel = path.relative(themeRoot, filePath);
	if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
		return rel;
	}
	let rootReal: string;
	try {
		rootReal = fs.realpathSync.native(themeRoot);
	} catch {
		return rel;
	}

	let fileResolvedAbsolute: string;
	try {
		fileResolvedAbsolute = fs.realpathSync.native(filePath);
	} catch {
		fileResolvedAbsolute = realpathReconstructFromExistingAncestors(filePath);
	}
	return path.relative(rootReal, fileResolvedAbsolute);
}

/**
 * Theme-relative path safe to upload/watch, or `null` if the path must be
 * skipped: outside the theme root, or any hidden segment (`.nuvem`, `.git`,
 * `.vscode`, …).
 */
export function themeUploadRelativePath(
	themeRoot: string,
	absolutePath: string,
): string | null {
	const rel = relativeToThemeRoot(themeRoot, absolutePath);
	if (
		rel.startsWith("..") ||
		path.isAbsolute(rel) ||
		isHiddenWorkspacePath(rel)
	) {
		return null;
	}
	return rel;
}
