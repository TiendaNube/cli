import { Command } from "commander";

/** Run Commander; `tail` is argv after the script (e.g. `["theme","list"]`). */
export async function parseWithTail(
	program: Command,
	tail: string[],
): Promise<void> {
	await program.parseAsync(tail, { from: "user" });
}

/** Program with `theme` parent and children bound on it. */
export function programWithThemeCommand(bind: (c: Command) => void): Command {
	const theme = new Command("theme");
	bind(theme);
	const program = new Command();
	// Mirror the real root program so `-y/--yes` is recognized and readable via
	// `optsWithGlobals()` from subcommands.
	program.option("-y, --yes", "Non-interactive: never prompt", false);
	program.addCommand(theme);
	return program;
}
