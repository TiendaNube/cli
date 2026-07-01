import fs from "node:fs";
import path from "node:path";
import {
	PUSH_UNSUPPORTED_PREFIXES,
	SYNC_PREFIXES,
} from "./theme-api-constants";

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
function isHiddenWorkspacePath(relativePath: string): boolean {
	const normalized = path.normalize(relativePath);
	return normalized
		.split(/[/\\]/)
		.filter((s) => s.length > 0)
		.some(isHiddenSegment);
}

export function isInSyncScope(relativePath: string): boolean {
	const norm = relativePath.replace(/\\/g, "/");
	return (
		relativePath === "" || // Allows root path
		SYNC_PREFIXES.some(
			(prefix) => norm === prefix || norm.startsWith(`${prefix}/`),
		)
	);
}

export function shouldSync(relativePath: string): boolean {
	return !isHiddenWorkspacePath(relativePath) && isInSyncScope(relativePath);
}

export function isPushUnsupported(relativePath: string): boolean {
	const norm = relativePath.replace(/\\/g, "/");
	return PUSH_UNSUPPORTED_PREFIXES.some(
		(prefix) => norm === prefix || norm.startsWith(`${prefix}/`),
	);
}

/** Top-level entries in `root` that belong to the CLI sync scope (non-hidden and matching SYNC_PREFIXES). */
export function listThemeEntries(root: string): string[] {
	return fs.readdirSync(root).filter(shouldSync);
}

/** Removes the given top-level entries from `root` (typically obtained via `listThemeEntries`). */
export function removeThemeEntries(root: string, entries: string[]): void {
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
	if (rel.startsWith("..") || path.isAbsolute(rel) || !shouldSync(rel)) {
		return null;
	}
	return rel;
}
