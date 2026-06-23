import { Command } from "commander";

export async function parseWithTail(
	program: Command,
	tail: string[],
): Promise<void> {
	await program.parseAsync(tail, { from: "user" });
}

export function programWithFtpSubcommand(bind: (c: Command) => void): Command {
	const ftp = new Command("ftp");
	bind(ftp);
	const program = new Command();
	// Mirror the real root program so `-y/--yes` is recognized and readable via
	// `optsWithGlobals()` from subcommands.
	program.option("-y, --yes", "Non-interactive: never prompt", false);
	program.addCommand(ftp);
	return program;
}
