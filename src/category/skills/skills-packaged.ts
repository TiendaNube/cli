import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** File every Agent Skills directory must contain. */
export const SKILL_FILE = "SKILL.md";

/** Directory holding the bundled skills, relative to the package root. */
export const SKILLS_DIR_NAME = "skills";

function isSkillDir(candidate: string): boolean {
	try {
		return fs.statSync(path.join(candidate, SKILL_FILE)).isFile();
	} catch {
		return false;
	}
}

/** Sorted names of the skills bundled in `skillsDir`. */
export function listPackagedSkills(skillsDir: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return (
		entries
			// Symlinks count: an installed destination holds links to skill folders,
			// and `withFileTypes` reports those as links rather than directories.
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name)
			.filter((name) => isSkillDir(path.join(skillsDir, name)))
			.sort()
	);
}

function hasBundledSkills(root: string): boolean {
	return listPackagedSkills(path.join(root, SKILLS_DIR_NAME)).length > 0;
}

/**
 * Locates the `skills/` folder that ships inside the package.
 *
 * Walking up from this module resolves the same directory in all three places
 * the code runs from — `dist/cli.js` in an installed package, `dist/cli.js` in a
 * local `npm link`, and `src/` under vitest — without hardcoding a depth that
 * only holds for one of them.
 */
export function resolvePackagedSkillsDir(startDir?: string): string {
	let current =
		startDir ?? path.dirname(fileURLToPath(new URL(import.meta.url)));
	let parent = path.dirname(current);
	while (!hasBundledSkills(current)) {
		if (parent === current) {
			return "";
		}
		current = parent;
		parent = path.dirname(current);
	}
	return path.join(current, SKILLS_DIR_NAME);
}

/** Minimal Agent Skills frontmatter: the two fields the spec requires. */
export type SkillFrontmatter = {
	name?: string;
	description?: string;
};

/**
 * Reads `name` and `description` out of a `SKILL.md` frontmatter block.
 *
 * A hand-rolled reader rather than a YAML dependency: the frontmatter this CLI
 * ships is flat scalars, and the only consumer is validation.
 */
export function readSkillFrontmatter(skillFile: string): SkillFrontmatter {
	const content = fs.readFileSync(skillFile, "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (match === null) {
		return {};
	}
	const frontmatter: SkillFrontmatter = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const field = /^(name|description):\s*(.*)$/.exec(line);
		if (field === null) {
			continue;
		}
		const value = (field[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
		if (field[1] === "name") {
			frontmatter.name = value;
		} else {
			frontmatter.description = value;
		}
	}
	return frontmatter;
}
