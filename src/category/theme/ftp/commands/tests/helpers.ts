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
	program.addCommand(ftp);
	return program;
}
