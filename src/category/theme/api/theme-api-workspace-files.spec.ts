import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	listThemeEntries,
	relativeToThemeRoot,
	removeThemeEntries,
	shouldSync,
	themeUploadRelativePath,
} from "./theme-api-workspace-files";

describe("shouldSync", () => {
	it("allows paths within sync prefixes", () => {
		expect(shouldSync("snippets/foo.tpl")).toBe(true);
		expect(shouldSync("templates/index.tpl")).toBe(true);
		expect(shouldSync("manifest.json")).toBe(true);
	});

	it("rejects paths outside sync prefixes", () => {
		expect(shouldSync("foo")).toBe(false);
		expect(shouldSync("README.md")).toBe(false);
		expect(shouldSync("package.json")).toBe(false);
	});

	it("rejects hidden paths even within sync prefixes", () => {
		expect(shouldSync(".nuvem")).toBe(false);
		expect(shouldSync(".gitignore")).toBe(false);
	});

	it("rejects paths under hidden directories", () => {
		expect(shouldSync(".git/objects/ab/cdef")).toBe(false);
		expect(shouldSync("templates/.hidden/file.txt")).toBe(false);
	});

	it("handles Windows-style separators", () => {
		expect(shouldSync("templates\\.vscode\\x")).toBe(false);
		expect(shouldSync("templates\\sub\\file.txt")).toBe(true);
	});

	it("does not treat parent-dir segments (..) as hidden", () => {
		expect(shouldSync("../real/theme/file.tpl")).toBe(false);
	});
});

describe("listThemeEntries", () => {
	it("returns only entries within sync scope", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-list-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "");
		fs.writeFileSync(path.join(root, ".gitignore"), "");
		fs.mkdirSync(path.join(root, ".vscode"));
		fs.mkdirSync(path.join(root, "templates"));
		fs.writeFileSync(path.join(root, "manifest.json"), "{}");
		fs.writeFileSync(path.join(root, "README.md"), "");

		expect(listThemeEntries(root).sort()).toEqual([
			"manifest.json",
			"templates",
		]);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("returns empty array when only hidden entries exist", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-list-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "");
		fs.mkdirSync(path.join(root, ".git"));

		expect(listThemeEntries(root)).toEqual([]);

		fs.rmSync(root, { recursive: true, force: true });
	});
});

describe("relativeToThemeRoot", () => {
	it("returns relative path when file is under theme root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-root-"));
		const file = path.join(root, "snippets", "x.tpl");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
		expect(relativeToThemeRoot(root, file)).toBe(
			path.join("snippets", "x.tpl"),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.skipIf(process.platform === "win32")(
		"resolves theme-relative path for a deleted file under symlinked theme root",
		() => {
			const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-real-"));
			const linkRoot = path.join(
				os.tmpdir(),
				`api-symlink-${process.pid}-${Date.now()}`,
			);
			fs.symlinkSync(realRoot, linkRoot, "dir");

			const templatesDir = path.join(realRoot, "templates");
			fs.mkdirSync(templatesDir, { recursive: true });
			const filePath = path.join(templatesDir, "gone.tpl");
			fs.writeFileSync(filePath, "x");
			const canonicalFilePath = fs.realpathSync.native(filePath);
			fs.unlinkSync(filePath);

			expect(themeUploadRelativePath(linkRoot, canonicalFilePath)).toBe(
				path.join("templates", "gone.tpl"),
			);

			fs.unlinkSync(linkRoot);
			fs.rmSync(realRoot, { recursive: true, force: true });
		},
	);
});

describe("themeUploadRelativePath", () => {
	it("returns null for hidden paths under theme root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-upload-"));
		const nubeFile = path.join(root, ".nuvem", "x");
		fs.mkdirSync(path.dirname(nubeFile), { recursive: true });
		fs.writeFileSync(nubeFile, "");
		expect(themeUploadRelativePath(root, nubeFile)).toBe(null);

		const dotDirFile = path.join(root, ".metadata", "config");
		fs.mkdirSync(path.dirname(dotDirFile), { recursive: true });
		fs.writeFileSync(dotDirFile, "");
		expect(themeUploadRelativePath(root, dotDirFile)).toBe(null);

		const cacheFile = path.join(root, "foo", ".cache", "y");
		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		fs.writeFileSync(cacheFile, "");
		expect(themeUploadRelativePath(root, cacheFile)).toBe(null);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("returns the relative path for normal theme files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-upload-"));
		const file = path.join(root, "layouts", "a.tpl");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
		expect(themeUploadRelativePath(root, file)).toBe(
			path.join("layouts", "a.tpl"),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});
});

describe("removeThemeEntries", () => {
	it("removes the given entries recursively", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-clean-"));
		fs.mkdirSync(path.join(root, "assets"));
		fs.writeFileSync(path.join(root, "assets", "logo.png"), "x");
		fs.mkdirSync(path.join(root, "templates"));
		fs.writeFileSync(path.join(root, "templates", "index.tpl"), "x");
		fs.writeFileSync(path.join(root, ".nuvem"), "config");

		removeThemeEntries(root, ["assets", "templates"]);

		expect(fs.existsSync(path.join(root, "assets"))).toBe(false);
		expect(fs.existsSync(path.join(root, "templates"))).toBe(false);
		expect(fs.existsSync(path.join(root, ".nuvem"))).toBe(true);

		fs.rmSync(root, { recursive: true, force: true });
	});

	it("is a no-op when no entries are given", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-clean-"));
		fs.writeFileSync(path.join(root, ".nuvem"), "config");

		expect(() => removeThemeEntries(root, [])).not.toThrow();
		expect(fs.existsSync(path.join(root, ".nuvem"))).toBe(true);

		fs.rmSync(root, { recursive: true, force: true });
	});
});
