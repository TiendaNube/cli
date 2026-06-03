import fs from "node:fs";
import path from "node:path";

export class ThemeFtpTools {
	/** Dotfile / dot-dir segment (not `.`, `..`, or empty). */
	static isDotHiddenPathSegment(segment: string): boolean {
		return (
			segment.length > 0 &&
			segment.startsWith(".") &&
			segment !== "." &&
			segment !== ".."
		);
	}

	/**
	 * Paths with any hidden path segment are never uploaded or watched
	 * (e.g. `.nuvem`, `.git`, `foo/.bar/baz`).
	 * Parent segments (`..`) are not treated as hidden — otherwise symlink vs
	 * realpath mismatches produce `../real/...` and the watcher ignores real files.
	 */
	static isExcludedFromThemeUpload(relativePath: string): boolean {
		const normalized = path.normalize(relativePath);
		const segments = normalized.split(/[/\\]/).filter((s) => s.length > 0);
		return segments.some((seg) => ThemeFtpTools.isDotHiddenPathSegment(seg));
	}

	/**
	 * When `absolutePath` is missing (e.g. after unlink), walk up to the nearest
	 * existing ancestor, resolve its real path, then append the removed suffix so
	 * the result matches the path the theme would have used if the file still existed.
	 */
	private static realpathReconstructFromExistingAncestors(
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
	static relativeToThemeRoot(themeRoot: string, filePath: string): string {
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
			fileResolvedAbsolute =
				ThemeFtpTools.realpathReconstructFromExistingAncestors(filePath);
		}
		return path.relative(rootReal, fileResolvedAbsolute);
	}

	/**
	 * Names in `root` that count as theme content (non-hidden top-level entries).
	 */
	static listThemeEntries(root: string): string[] {
		return fs
			.readdirSync(root)
			.filter((name) => !ThemeFtpTools.isExcludedFromThemeUpload(name));
	}

	/**
	 * Removes the given top-level entries from `root`. Caller is expected to pass
	 * only names obtained via `listThemeEntries` so dot-hidden entries (`.nuvem`,
	 * `.git`, …) are never touched.
	 */
	static cleanThemeWorkspace(root: string, entries: string[]): void {
		for (const name of entries) {
			fs.rmSync(path.join(root, name), { recursive: true, force: true });
		}
	}

	/**
	 * Theme-relative path safe to upload/watch, or `null` if the path must be skipped:
	 * outside the theme root, or any dot-hidden segment (`.nuvem`, `.git`, `.vscode`, …).
	 */
	static themeUploadRelativePath(
		themeRoot: string,
		absolutePath: string,
	): string | null {
		const rel = ThemeFtpTools.relativeToThemeRoot(themeRoot, absolutePath);
		if (
			rel.startsWith("..") ||
			path.isAbsolute(rel) ||
			ThemeFtpTools.isExcludedFromThemeUpload(rel)
		) {
			return null;
		}
		return rel;
	}

	ChunkArray<T>(items: T[], numChunks: number): T[][] {
		if (!Number.isInteger(numChunks) || numChunks <= 0) {
			throw new RangeError("numChunks must be a positive integer");
		}
		const chunks: T[][] = [];
		const size = Math.ceil(items.length / numChunks);

		Array.from({ length: numChunks }, (_, i) => {
			const start = i * size;
			const end = start + size;
			chunks.push(items.slice(start, end));
		});

		return chunks;
	}
}
