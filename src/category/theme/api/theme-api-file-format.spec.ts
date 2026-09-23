import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	isPathInsideThemeRoot,
	readThemeFileContent,
} from "./theme-api-file-format";

const tmpFiles: string[] = [];

function writeTmpFile(name: string, contents: string | Buffer): string {
	const full = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "theme-file-format-")),
		name,
	);
	fs.writeFileSync(full, contents);
	tmpFiles.push(full);
	return full;
}

afterEach(() => {
	for (const f of tmpFiles.splice(0)) {
		fs.rmSync(path.dirname(f), { recursive: true, force: true });
	}
});

describe("readThemeFileContent", () => {
	it("sends .json as raw text, byte for byte", () => {
		const raw = '{\n  "a": 1,\n  "url": "https://x.test/a"\n}\n';
		const full = writeTmpFile("settings.json", raw);

		expect(readThemeFileContent(full, "config/settings.json")).toEqual({
			format: "text",
			content: raw,
		});
	});

	it("rejects malformed .json before it reaches the API", () => {
		const full = writeTmpFile("broken.json", "{ nope");

		expect(() => readThemeFileContent(full, "config/broken.json")).toThrow(
			/Invalid JSON/,
		);
	});

	it("reads .tpl as text", () => {
		const full = writeTmpFile("header.tpl", "<div>{{ x }}</div>");

		expect(readThemeFileContent(full, "sections/header.tpl")).toEqual({
			format: "text",
			content: "<div>{{ x }}</div>",
		});
	});

	it("reads other extensions as base64", () => {
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		const full = writeTmpFile("logo.png", bytes);

		expect(readThemeFileContent(full, "assets/logo.png")).toEqual({
			format: "base64",
			content: bytes.toString("base64"),
		});
	});
});

describe("isPathInsideThemeRoot", () => {
	it("allows normal nested paths", () => {
		const root = path.resolve(path.join(os.tmpdir(), "theme-root-in"));
		expect(isPathInsideThemeRoot(root, "snippets/a.tpl")).toBe(true);
	});

	it("rejects path traversal", () => {
		const root = path.resolve(path.join(os.tmpdir(), "theme-root-safe"));
		expect(isPathInsideThemeRoot(root, "../outside")).toBe(false);
	});
});
