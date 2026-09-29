import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsInstallCommand } from "../commands/skills-install";
import {
	SKILLS_AGENTS,
	agentNames,
	findAgent,
	resolveDestinations,
} from "../skills-agents";
import { applySkillLink, planSkillLink } from "../skills-link";
import {
	SKILL_FILE,
	listPackagedSkills,
	readSkillFrontmatter,
	resolvePackagedSkillsDir,
} from "../skills-packaged";

let workdir = "";

function makeSkill(
	root: string,
	name: string,
	description = "A test skill",
): void {
	const dir = path.join(root, "skills", name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, SKILL_FILE),
		`---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
	);
}

beforeEach(() => {
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvemshop-skills-"));
});

afterEach(() => {
	fs.rmSync(workdir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("packaged skills discovery", () => {
	it("finds the skills folder by walking up from the CLI code", () => {
		const dir = resolvePackagedSkillsDir();
		expect(listPackagedSkills(dir)).toContain("nuvemshop-theme-use-cases");
	});

	it("returns an empty path when no bundled skills exist above the start", () => {
		expect(resolvePackagedSkillsDir(workdir)).toBe("");
	});

	it("ignores directories without a SKILL.md", () => {
		makeSkill(workdir, "with-skill");
		fs.mkdirSync(path.join(workdir, "skills", "empty"), { recursive: true });
		expect(listPackagedSkills(path.join(workdir, "skills"))).toEqual([
			"with-skill",
		]);
	});

	it("reads name and description out of the frontmatter", () => {
		makeSkill(workdir, "quoted", '"Quoted description"');
		const frontmatter = readSkillFrontmatter(
			path.join(workdir, "skills", "quoted", SKILL_FILE),
		);
		expect(frontmatter).toEqual({
			name: "quoted",
			description: "Quoted description",
		});
	});
});

describe("destinations", () => {
	it("collapses every agent that shares one project directory", () => {
		const destinations = resolveDestinations({
			agents: SKILLS_AGENTS,
			scope: "project",
			cwd: "/tmp/theme",
		});
		const shared = destinations.find(
			(destination) =>
				destination.path === path.join("/tmp/theme", ".agents", "skills"),
		);
		const expected = SKILLS_AGENTS.filter(
			(agent) => agent.projectDir === path.join(".agents", "skills"),
		).map((agent) => agent.name);

		expect(expected.length).toBeGreaterThan(4);
		expect(shared?.agents).toEqual(expected);
	});

	it("emits one destination per distinct directory, whatever the scope", () => {
		for (const scope of ["global", "project"] as const) {
			const destinations = resolveDestinations({
				agents: SKILLS_AGENTS,
				scope,
				cwd: "/tmp/theme",
			});
			// Several clients deliberately point at the same folder (`~/.agents/skills`
			// globally, `.agents/skills` in a project), so the count is the number of
			// distinct folders, not of agents.
			const paths = new Set(
				destinations.map((destination) => destination.path),
			);
			expect(paths.size).toBe(destinations.length);
			expect(
				destinations.flatMap((destination) => destination.agents).sort(),
			).toEqual(SKILLS_AGENTS.map((agent) => agent.name).sort());
		}
	});

	it("honours CLAUDE_CONFIG_DIR for the global Claude Code directory", () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(workdir, "elsewhere"));
		expect(findAgent("claude-code")?.GlobalDir()).toBe(
			path.join(workdir, "elsewhere", "skills"),
		);
	});
});

describe("linking one skill", () => {
	it("creates, then reports unchanged on a second run", () => {
		makeSkill(workdir, "alpha");
		const source = path.join(workdir, "skills");
		const destination = path.join(workdir, "dest");

		const first = applySkillLink({
			sourceDir: source,
			destinationDir: destination,
			name: "alpha",
			mode: "symlink",
			force: false,
		});
		expect(first.action).toBe("created");
		expect(
			fs.readFileSync(path.join(destination, "alpha", SKILL_FILE), "utf8"),
		).toContain("name: alpha");

		const second = applySkillLink({
			sourceDir: source,
			destinationDir: destination,
			name: "alpha",
			mode: "symlink",
			force: false,
		});
		expect(second.action).toBe("unchanged");
		expect(fs.lstatSync(path.join(destination, "alpha")).isSymbolicLink()).toBe(
			true,
		);
	});

	it("copies real files with --copy, and replaces an existing symlink", () => {
		makeSkill(workdir, "alpha");
		const source = path.join(workdir, "skills");
		const destination = path.join(workdir, "dest");

		applySkillLink({
			sourceDir: source,
			destinationDir: destination,
			name: "alpha",
			mode: "symlink",
			force: false,
		});
		const copied = applySkillLink({
			sourceDir: source,
			destinationDir: destination,
			name: "alpha",
			mode: "copy",
			force: false,
		});

		expect(copied.action).toBe("updated");
		expect(fs.lstatSync(path.join(destination, "alpha")).isSymbolicLink()).toBe(
			false,
		);
	});

	it("relinks a symlink left pointing at an older install path", () => {
		makeSkill(workdir, "alpha");
		const destination = path.join(workdir, "dest");
		fs.mkdirSync(destination, { recursive: true });
		fs.symlinkSync(path.join(workdir, "gone"), path.join(destination, "alpha"));

		expect(
			planSkillLink({
				sourceDir: path.join(workdir, "skills"),
				destinationDir: destination,
				name: "alpha",
				mode: "symlink",
			}).action,
		).toBe("updated");
	});

	it("refuses to replace a real directory unless forced", () => {
		makeSkill(workdir, "alpha");
		const destination = path.join(workdir, "dest");
		fs.mkdirSync(path.join(destination, "alpha"), { recursive: true });
		fs.writeFileSync(
			path.join(destination, "alpha", "mine.md"),
			"hand-written",
		);

		const options = {
			sourceDir: path.join(workdir, "skills"),
			destinationDir: destination,
			name: "alpha",
			mode: "symlink" as const,
		};
		expect(planSkillLink(options).action).toBe("conflict");
		expect(applySkillLink({ ...options, force: false }).action).toBe(
			"conflict",
		);
		expect(fs.existsSync(path.join(destination, "alpha", "mine.md"))).toBe(
			true,
		);

		expect(applySkillLink({ ...options, force: true }).action).toBe("updated");
		expect(fs.existsSync(path.join(destination, "alpha", "mine.md"))).toBe(
			false,
		);
	});
});

type InstallRun = {
	output: string;
	errors: string;
	exitCode: number | undefined;
};

/**
 * Runs `skills install` the way Commander would, with the given argv tail.
 *
 * `runAction` is what the command is bound through, and it turns a `CliError`
 * into a logged message plus `process.exitCode` rather than a rejection — so a
 * failing run is asserted on those two, not on a thrown error.
 */
async function runInstall(argv: string[]): Promise<InstallRun> {
	const program = new Command();
	program.option("-y, --yes", "Non-interactive", false);
	const skills = program.command("skills");
	new SkillsInstallCommand().Bind(skills);

	const written: string[] = [];
	const errors: string[] = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		written.push(String(chunk));
		return true;
	});
	const logged = vi.spyOn(console, "log").mockImplementation((...args) => {
		written.push(args.join(" "));
	});
	const failed = vi.spyOn(console, "error").mockImplementation((...args) => {
		errors.push(args.join(" "));
	});
	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		await program.parseAsync(["node", "cli", "skills", "install", ...argv]);
		return {
			output: written.join("\n"),
			errors: errors.join("\n"),
			exitCode: process.exitCode,
		};
	} finally {
		process.exitCode = previousExitCode;
		logged.mockRestore();
		failed.mockRestore();
	}
}

describe("skills install", () => {
	it("reports the plan as JSON and writes nothing on --dry-run", () => {
		const home = path.join(workdir, "home");
		fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
		vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(home, ".claude"));

		return runInstall(["--agent", "claude-code", "--dry-run", "--json"]).then(
			({ output }) => {
				const report = JSON.parse(output);
				expect(report.scope).toBe("global");
				expect(report.mode).toBe("symlink");
				expect(report.dryRun).toBe(true);
				expect(report.skills).toContain("nuvemshop-theme-use-cases");
				expect(report.destinations).toHaveLength(1);
				expect(report.destinations[0].summary.created).toBe(
					report.skills.length,
				);
				expect(fs.existsSync(path.join(home, ".claude", "skills"))).toBe(false);
			},
		);
	});

	it("installs the bundled skills, then reports them unchanged", async () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(workdir, "home", ".claude"));

		await runInstall(["--agent", "claude-code"]);
		const installed = path.join(workdir, "home", ".claude", "skills");
		const names = listPackagedSkills(installed);
		expect(names).toEqual(listPackagedSkills(resolvePackagedSkillsDir()));

		const second = JSON.parse(
			(await runInstall(["--agent", "claude-code", "--json"])).output,
		);
		expect(second.destinations[0].summary.unchanged).toBe(names.length);
		expect(second.destinations[0].summary.created).toBe(0);
	});

	it("rejects an unknown agent, naming the ones it accepts", async () => {
		const run = await runInstall(["--agent", "emacs"]);
		expect(run.exitCode).toBe(1);
		expect(run.errors).toContain('Unknown agent "emacs"');
		expect(run.errors).toContain(agentNames().join(", "));
	});

	it("asks before replacing a directory it did not write", async () => {
		const claudeHome = path.join(workdir, "home", ".claude");
		vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);
		const [firstSkill = ""] = listPackagedSkills(resolvePackagedSkillsDir());
		const occupied = path.join(claudeHome, "skills", firstSkill);
		fs.mkdirSync(occupied, { recursive: true });
		fs.writeFileSync(path.join(occupied, "mine.md"), "hand-written");

		// No TTY under vitest, so the confirmation cannot be answered and the run
		// aborts rather than deleting anything.
		const run = await runInstall(["--agent", "claude-code"]);
		expect(run.exitCode).toBe(1);
		expect(run.errors).toContain("Destructive operation requires confirmation");
		expect(fs.existsSync(path.join(occupied, "mine.md"))).toBe(true);
	});
});
