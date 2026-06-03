import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideThemeRoot } from "./theme-api-file-format";

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
