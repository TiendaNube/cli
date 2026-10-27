import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CATEGORY_DIR = path.resolve(import.meta.dirname, "../..");

function commandFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter(
			(file) =>
				file.endsWith(".ts") &&
				!file.endsWith(".spec.ts") &&
				file.includes(`commands${path.sep}`),
		)
		.map((file) => path.join(dir, file));
}

/**
 * Derived from the source rather than from a list: a command added later that
 * resolves a credential without offering `--alias` fails here.
 */
describe("--alias coverage", () => {
	const files = commandFiles(path.join(CATEGORY_DIR, "theme"));
	const resolving = files.filter((file) => {
		const source = fs.readFileSync(file, "utf8");
		return /resolveApiCredentials\(|\.TryLoad\(/.test(source);
	});

	it("finds the commands that resolve credentials", () => {
		// 16 Public API commands + 4 FTP sync commands.
		expect(resolving).toHaveLength(20);
	});

	it.each(resolving.map((file) => [path.relative(CATEGORY_DIR, file), file]))(
		"%s registers --alias and passes it to resolution",
		(_name, file) => {
			const source = fs.readFileSync(file, "utf8");
			expect(source).toContain("authAliasOption()");
			expect(source).toMatch(/alias: options\.alias/);
		},
	);

	const building = files.filter((file) =>
		/new Theme(Api|Ftp)Client\(/.test(fs.readFileSync(file, "utf8")),
	);

	it.each(building.map((file) => [path.relative(CATEGORY_DIR, file), file]))(
		"%s hands the resolved credential to its client, so a refusal names it",
		(_name, file) => {
			const source = fs.readFileSync(file, "utf8");
			const apiClients = source.match(/new ThemeApiClient\(\{[^}]*\}\)/g) ?? [];
			for (const call of apiClients) {
				expect(call).toContain("credential: loaded");
			}
			const ftpClients = source.match(/new ThemeFtpClient\([^)]*\)/g) ?? [];
			for (const call of ftpClients) {
				expect(call).toMatch(/, loaded\)$/);
			}
		},
	);
});
