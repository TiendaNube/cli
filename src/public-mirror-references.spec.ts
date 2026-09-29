import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `src/` — specs included — is copied verbatim to the public repo on every
 * release, so a Linear key or a reference to the private repo in a comment
 * leaks the moment it ships.
 */
const INTERNAL_REFERENCE = /\bEXT-\d+\b|linear\.app|cli-internal/i;

const thisFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(thisFile);

function sourceFiles(): string[] {
	return fs
		.readdirSync(srcDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name))
		.filter((file) => file !== thisFile);
}

describe("public mirror", () => {
	it("keeps internal references out of src/", () => {
		const offenders = sourceFiles().flatMap((file) =>
			fs
				.readFileSync(file, "utf8")
				.split("\n")
				.flatMap((line, index) =>
					INTERNAL_REFERENCE.test(line)
						? [`${path.relative(srcDir, file)}:${index + 1}: ${line.trim()}`]
						: [],
				),
		);

		expect(offenders).toEqual([]);
	});
});
