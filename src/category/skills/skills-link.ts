import fs from "node:fs";
import path from "node:path";
import { CliError } from "../../cli-action";

/** How a skill is placed in the destination. */
export type SkillsLinkMode = "symlink" | "copy";

/**
 * What installing one skill into one destination does.
 *
 * `conflict` is the only outcome that needs a human: the destination holds real
 * content this command did not write, and replacing it would delete somebody
 * else's files.
 */
export type SkillsLinkAction = "created" | "updated" | "unchanged" | "conflict";

export type SkillsLinkResult = {
	name: string;
	action: SkillsLinkAction;
};

function lstatOrNull(target: string): fs.Stats | null {
	try {
		return fs.lstatSync(target);
	} catch {
		return null;
	}
}

function symlinkTarget(link: string): string | null {
	try {
		return path.resolve(path.dirname(link), fs.readlinkSync(link));
	} catch {
		return null;
	}
}

/**
 * Junctions on Windows, directory symlinks everywhere else.
 *
 * A junction is the one link type Windows creates without developer mode or an
 * elevated shell, so it keeps the default path working there; `--copy` remains
 * the escape hatch when even that is refused.
 */
function symlinkType(): "junction" | "dir" {
	return process.platform === "win32" ? "junction" : "dir";
}

function copyDirectory(source: string, destination: string): void {
	fs.cpSync(source, destination, { recursive: true });
}

function createLink(
	source: string,
	destination: string,
	mode: SkillsLinkMode,
): void {
	if (mode === "copy") {
		copyDirectory(source, destination);
		return;
	}
	try {
		fs.symlinkSync(source, destination, symlinkType());
	} catch (err) {
		const code = (err as { code?: string } | null)?.code;
		if (code === "EPERM" || code === "EACCES") {
			throw new CliError(
				`Not allowed to create a symlink at ${destination}. Re-run with --copy to copy the skills instead.`,
			);
		}
		throw err;
	}
}

/**
 * Decides what installing `name` into `destinationDir` would do, without
 * touching disk.
 *
 * Split from the write so a run can be planned first: `--dry-run` reports the
 * plan, and a real run uses it to ask about every conflict up front instead of
 * stopping halfway through with some destinations already written.
 */
export function planSkillLink(options: {
	sourceDir: string;
	destinationDir: string;
	name: string;
	mode: SkillsLinkMode;
}): SkillsLinkResult {
	const source = path.join(options.sourceDir, options.name);
	const target = path.join(options.destinationDir, options.name);
	const stats = lstatOrNull(target);

	if (stats === null) {
		return { name: options.name, action: "created" };
	}
	if (stats.isSymbolicLink()) {
		if (options.mode === "copy") {
			return { name: options.name, action: "updated" };
		}
		const current = symlinkTarget(target);
		return {
			name: options.name,
			action: current === path.resolve(source) ? "unchanged" : "updated",
		};
	}
	// A real directory or file this command did not write: never silently removed.
	return { name: options.name, action: "conflict" };
}

/**
 * Installs one skill, applying the plan.
 *
 * `force` is what a confirmed conflict looks like — the caller has already told
 * the user which directory would be replaced and got a yes.
 */
export function applySkillLink(options: {
	sourceDir: string;
	destinationDir: string;
	name: string;
	mode: SkillsLinkMode;
	force: boolean;
}): SkillsLinkResult {
	const planned = planSkillLink(options);
	if (planned.action === "unchanged") {
		return planned;
	}
	if (planned.action === "conflict" && !options.force) {
		return planned;
	}

	const source = path.join(options.sourceDir, options.name);
	const target = path.join(options.destinationDir, options.name);
	fs.mkdirSync(options.destinationDir, { recursive: true });
	if (lstatOrNull(target) !== null) {
		fs.rmSync(target, { recursive: true, force: true });
	}
	createLink(source, target, options.mode);
	return {
		name: options.name,
		action: planned.action === "conflict" ? "updated" : planned.action,
	};
}
