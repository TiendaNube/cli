import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ThemeFtpTools } from "./theme-ftp-tools";

describe("ThemeFtpTools", () => {
	const tools = new ThemeFtpTools();

	it("should be defined", () => {
		expect(tools).toBeDefined();
	});

	it("should split an array into the given number of chunks", () => {
		const result = tools.ChunkArray([1, 2, 3, 4, 5, 6], 3);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual([1, 2]);
		expect(result[1]).toEqual([3, 4]);
		expect(result[2]).toEqual([5, 6]);
	});

	it("should throw an error if the number of chunks is not a positive integer", () => {
		expect(() => tools.ChunkArray([1, 2, 3, 4, 5, 6], 0)).toThrow(RangeError);
		expect(() => tools.ChunkArray([1, 2, 3, 4, 5, 6], -1)).toThrow(RangeError);
		expect(() => tools.ChunkArray([1, 2, 3, 4, 5, 6], 1.5)).toThrow(RangeError);
	});
});

describe("ThemeFtpTools.isExcludedFromThemeUpload", () => {
	it("allows normal theme paths", () => {
		expect(ThemeFtpTools.isExcludedFromThemeUpload("snippets/foo.tpl")).toBe(
			false,
		);
		expect(ThemeFtpTools.isExcludedFromThemeUpload("templates/index.tpl")).toBe(
			false,
		);
		expect(ThemeFtpTools.isExcludedFromThemeUpload("foo")).toBe(false);
	});

	it("excludes .nuvem and other dotfiles at root", () => {
		expect(ThemeFtpTools.isExcludedFromThemeUpload(".nuvem")).toBe(true);
		expect(ThemeFtpTools.isExcludedFromThemeUpload(".gitignore")).toBe(true);
	});

	it("excludes paths under hidden directories", () => {
		expect(
			ThemeFtpTools.isExcludedFromThemeUpload(".git/objects/ab/cdef"),
		).toBe(true);
		expect(
			ThemeFtpTools.isExcludedFromThemeUpload("src/.hidden/file.txt"),
		).toBe(true);
	});

	it("handles Windows-style separators", () => {
		expect(ThemeFtpTools.isExcludedFromThemeUpload("src\\.vscode\\x")).toBe(
			true,
		);
		expect(ThemeFtpTools.isExcludedFromThemeUpload("ok\\sub\\file.txt")).toBe(
			false,
		);
	});

	it("does not treat parent-dir segments (..) as hidden dot segments", () => {
		expect(
			ThemeFtpTools.isExcludedFromThemeUpload("../real/theme/file.tpl"),
		).toBe(false);
	});
});

describe("ThemeFtpTools.listThemeEntries", () => {
	it("returns only non-hidden top-level entries", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-list-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "");
		fs.writeFileSync(path.join(root, ".gitignore"), "");
		fs.mkdirSync(path.join(root, ".vscode"));
		fs.mkdirSync(path.join(root, "assets"));
		fs.writeFileSync(path.join(root, "manifest.json"), "{}");

		expect(ThemeFtpTools.listThemeEntries(root).sort()).toEqual([
			"assets",
			"manifest.json",
		]);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("returns empty array when only hidden entries exist", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-list-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "");
		fs.mkdirSync(path.join(root, ".git"));

		expect(ThemeFtpTools.listThemeEntries(root)).toEqual([]);

		fs.rmSync(root, { recursive: true, force: true });
	});
});

describe("ThemeFtpTools.cleanThemeWorkspace", () => {
	it("removes the given entries recursively", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-clean-"));
		fs.mkdirSync(path.join(root, "assets"));
		fs.writeFileSync(path.join(root, "assets", "logo.png"), "x");
		fs.mkdirSync(path.join(root, "templates"));
		fs.writeFileSync(path.join(root, "templates", "index.tpl"), "x");
		fs.writeFileSync(path.join(root, ".nuvem"), "config");

		ThemeFtpTools.cleanThemeWorkspace(root, ["assets", "templates"]);

		expect(fs.existsSync(path.join(root, "assets"))).toBe(false);
		expect(fs.existsSync(path.join(root, "templates"))).toBe(false);
		expect(fs.existsSync(path.join(root, ".nuvem"))).toBe(true);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("is a no-op when no entries are given", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-clean-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "config");

		expect(() => ThemeFtpTools.cleanThemeWorkspace(root, [])).not.toThrow();
		expect(fs.existsSync(path.join(root, ".nuvem"))).toBe(true);

		fs.rmSync(root, { recursive: true, force: true });
	});
});

describe("ThemeFtpTools.relativeToThemeRoot", () => {
	it("returns relative path when file is under theme root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-root-"));
		const file = path.join(root, "snipplets", "x.tpl");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
		expect(ThemeFtpTools.relativeToThemeRoot(root, file)).toBe(
			path.join("snipplets", "x.tpl"),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.skipIf(process.platform === "win32")(
		"resolves theme-relative path for a deleted file under symlinked theme root (real path + link cwd)",
		() => {
			const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-real-"));
			const linkRoot = path.join(
				os.tmpdir(),
				`theme-symlink-${process.pid}-${Date.now()}`,
			);
			fs.symlinkSync(realRoot, linkRoot, "dir");

			const templatesDir = path.join(realRoot, "templates");
			fs.mkdirSync(templatesDir, { recursive: true });
			const filePath = path.join(templatesDir, "gone.tpl");
			fs.writeFileSync(filePath, "x");
			const canonicalFilePath = fs.realpathSync.native(filePath);
			fs.unlinkSync(filePath);

			expect(
				ThemeFtpTools.themeUploadRelativePath(linkRoot, canonicalFilePath),
			).toBe(path.join("templates", "gone.tpl"));

			fs.unlinkSync(linkRoot);
			fs.rmSync(realRoot, { recursive: true, force: true });
		},
	);
});

describe("ThemeFtpTools.themeUploadRelativePath", () => {
	it("returns null for .nuvem, dot-only dirs, and nested paths under dot dirs", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-upload-"));
		const nubeFile = path.join(root, ".nuvem", "x");
		fs.mkdirSync(path.dirname(nubeFile), { recursive: true });
		fs.writeFileSync(nubeFile, "");
		expect(ThemeFtpTools.themeUploadRelativePath(root, nubeFile)).toBe(null);

		// Avoid `.git` under tmp: some OSes restrict writes there; `.metadata` is still a dot-dir.
		const dotDirFile = path.join(root, ".metadata", "config");
		fs.mkdirSync(path.dirname(dotDirFile), { recursive: true });
		fs.writeFileSync(dotDirFile, "");
		expect(ThemeFtpTools.themeUploadRelativePath(root, dotDirFile)).toBe(null);

		const cacheFile = path.join(root, "foo", ".cache", "y");
		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		fs.writeFileSync(cacheFile, "");
		expect(ThemeFtpTools.themeUploadRelativePath(root, cacheFile)).toBe(null);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("returns relative path for normal theme files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-upload-"));
		const file = path.join(root, "layouts", "a.tpl");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
		expect(ThemeFtpTools.themeUploadRelativePath(root, file)).toBe(
			path.join("layouts", "a.tpl"),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
