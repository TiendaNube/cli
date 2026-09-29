import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
	canPushRelativePathWhenNotForked,
	isThemeCodeFileForNonForkedTheme,
} from "../../theme/api/theme-api-fork-rules";
import { isPushUnsupported } from "../../theme/api/theme-api-workspace-files";
import { ThemeCommands } from "../../theme/theme-commands";
import { SkillsCommands } from "../skills";
import {
	SKILL_FILE,
	listPackagedSkills,
	readSkillFrontmatter,
	resolvePackagedSkillsDir,
} from "../skills-packaged";

const skillsDir = resolvePackagedSkillsDir();
const skillNames = listPackagedSkills(skillsDir);

function skillBody(name: string): string {
	return fs.readFileSync(path.join(skillsDir, name, SKILL_FILE), "utf8");
}

/**
 * Every command path the CLI actually registers, with the long flags valid on
 * it (its own, plus the globals declared on the root).
 *
 * Built from the same `Bind` calls `src/cli.ts` makes, so the expectations come
 * from the code rather than from a list somebody has to remember to update.
 */
function commandSurface(): Map<string, Set<string>> {
	const program = new Command();
	program.option("-y, --yes", "Non-interactive", false);
	new ThemeCommands().Bind(program);
	new SkillsCommands().Bind(program);

	const surface = new Map<string, Set<string>>();
	const walk = (command: Command, prefix: string[], inherited: string[]) => {
		const own = command.options.flatMap((option) =>
			[option.long].filter((flag): flag is string => flag !== undefined),
		);
		const flags = [...inherited, ...own];
		if (prefix.length > 0) {
			surface.set(prefix.join(" "), new Set(flags));
		}
		for (const child of command.commands) {
			walk(child, [...prefix, child.name()], flags);
		}
	};
	walk(program, [], []);
	return surface;
}

const surface = commandSurface();

/**
 * Command paths that only group other commands (`theme`, `theme ftp`).
 *
 * A group followed by a word that does not extend it is an invented
 * subcommand — which is exactly how `theme ftp diff`, a command that exists on
 * no released CLI, would otherwise pass as a mention of `theme ftp`.
 */
const commandGroups = new Set<string>();
for (const key of surface.keys()) {
	const parts = key.split(" ");
	for (let index = 1; index < parts.length; index++) {
		commandGroups.add(parts.slice(0, index).join(" "));
	}
}

type Invocation = {
	skill: string;
	command: string | null;
	flags: string[];
	raw: string;
};

/**
 * Pulls every `nuvemshop …` / `tiendanube …` invocation out of a skill.
 *
 * The command path is the longest leading run of words that names a real
 * command, which is what separates `theme ftp setup` in a code block from
 * `theme ftp setup` followed by prose in a sentence. A match with no command
 * words at all is a skill name (`nuvemshop-theme-use-cases`) or a package name
 * (`@tiendanube/cli`), not an invocation.
 */
function invocations(skill: string, body: string): Invocation[] {
	const found: Invocation[] = [];
	// Stops at a backtick without consuming it, so two inline invocations on one
	// line are both seen.
	const pattern = /\b(?:nuvemshop|tiendanube)\b([^\n`]*)/g;
	let match = pattern.exec(body);
	while (match !== null) {
		const tokens = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
		const words: string[] = [];
		for (const token of tokens) {
			const word = token.replace(/[),.;:]+$/, "");
			if (!/^[a-z][a-z-]*$/.test(word)) {
				break;
			}
			words.push(word);
		}
		let command: string | null = null;
		for (let length = Math.min(words.length, 3); length > 0; length--) {
			const candidate = words.slice(0, length).join(" ");
			if (surface.has(candidate)) {
				command = candidate;
				break;
			}
		}
		// A group with a word after it names a subcommand that does not exist.
		const depth = command === null ? 0 : command.split(" ").length;
		if (
			command !== null &&
			commandGroups.has(command) &&
			words.length > depth
		) {
			command = null;
		}
		if (words.length > 0) {
			found.push({
				skill,
				command,
				flags: tokens
					.slice(depth)
					.filter((token) => token.startsWith("--"))
					.map((token) => token.replace(/[),.;:]+$/, "")),
				raw: match[0].trim(),
			});
		}
		match = pattern.exec(body);
	}
	return found;
}

const allInvocations = skillNames.flatMap((name) =>
	invocations(name, skillBody(name)),
);

describe("bundled skills", () => {
	it("ships the skills folder next to the CLI", () => {
		expect(skillsDir).not.toBe("");
		expect(path.basename(skillsDir)).toBe("skills");
		expect(skillNames.length).toBeGreaterThan(0);
	});

	it("names every skill after its own directory, within the spec's limits", () => {
		for (const name of skillNames) {
			const frontmatter = readSkillFrontmatter(
				path.join(skillsDir, name, SKILL_FILE),
			);
			expect(frontmatter.name, `${name}: missing name`).toBe(name);
			// Agent Skills spec: 1-64 chars, lowercase alphanumerics and hyphens,
			// no leading, trailing or doubled hyphen.
			expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			expect(name.length).toBeLessThanOrEqual(64);
			expect(
				frontmatter.description ?? "",
				`${name}: missing description`,
			).not.toBe("");
			expect((frontmatter.description ?? "").length).toBeLessThanOrEqual(1024);
		}
	});

	it("keeps every skill under the 500-line guidance", () => {
		for (const name of skillNames) {
			expect(skillBody(name).split("\n").length, name).toBeLessThanOrEqual(500);
		}
	});

	it("prefixes every skill with the brand, so the name survives being copied", () => {
		for (const name of skillNames) {
			expect(name.startsWith("nuvemshop-"), name).toBe(true);
		}
	});
});

describe("skills against the real command surface", () => {
	it("cites commands only when they exist", () => {
		const invented = allInvocations.filter(
			(invocation) => invocation.command === null,
		);
		expect(
			invented.map((invocation) => `${invocation.skill}: ${invocation.raw}`),
		).toEqual([]);
	});

	it("cites only flags the command accepts", () => {
		const unknown: string[] = [];
		for (const invocation of allInvocations) {
			if (invocation.command === null) {
				continue;
			}
			const flags = surface.get(invocation.command);
			for (const flag of invocation.flags) {
				if (flags?.has(flag) !== true) {
					unknown.push(
						`${invocation.skill}: ${flag} is not an option of "${invocation.command}"`,
					);
				}
			}
		}
		expect(unknown).toEqual([]);
	});

	it("reaches the commands the workflows are built on", () => {
		const cited = new Set(
			allInvocations
				.map((invocation) => invocation.command)
				.filter((command): command is string => command !== null),
		);
		for (const command of [
			"theme authorize",
			"theme list",
			"theme pull",
			"theme diff",
			"theme push",
			"theme publish",
			"theme fork",
			"theme ftp pull",
			"theme ftp push",
			"theme ftp setup",
		]) {
			expect(cited, `no skill mentions ${command}`).toContain(command);
		}
	});
});

describe("fork rules stay in step with the code that enforces them", () => {
	const forkRules = skillBody("nuvemshop-fork-and-push-rules");

	/** The bullet list under the "pushable without a fork" heading. */
	function pushablePathsFromSkill(): string[] {
		const section = /## Instance data[^\n]*\n([\s\S]*?)\n#/.exec(forkRules);
		expect(section, "pushable-paths section not found").not.toBeNull();
		return [...(section?.[1] ?? "").matchAll(/^- `([^`]+)`/gm)]
			.map((match) => match[1] ?? "")
			.filter((listed) => listed !== "");
	}

	it("lists as pushable only paths the push really accepts unforked", () => {
		const paths = pushablePathsFromSkill();
		expect(paths.length).toBeGreaterThan(0);
		for (const listed of paths) {
			expect(
				canPushRelativePathWhenNotForked(listed),
				`${listed} is documented as pushable without a fork, but the push treats it as theme code`,
			).toBe(true);
		}
	});

	it("does not promise theme code can be pushed unforked", () => {
		for (const codePath of [
			"sections/header.tpl",
			"blocks/heading.tpl",
			"snippets/icon.tpl",
			"layouts/layout.tpl",
			"config/settings_schema.json",
			"static/css/style.css",
		]) {
			expect(isThemeCodeFileForNonForkedTheme(codePath), codePath).toBe(true);
			expect(pushablePathsFromSkill()).not.toContain(codePath);
		}
	});

	it("still tells the truth about custom/ being skipped by the push", () => {
		expect(isPushUnsupported("custom/anything.tpl")).toBe(true);
		expect(forkRules).toMatch(
			/`custom\/` is instance data the CLI still cannot push/,
		);
	});
});
