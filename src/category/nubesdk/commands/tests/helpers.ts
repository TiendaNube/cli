import { Command } from "commander";

export async function parseWithTail(
	program: Command,
	tail: string[],
): Promise<void> {
	await program.parseAsync(tail, { from: "user" });
}

export function programWithNubesdkSubcommand(
	bind: (c: Command) => void,
): Command {
	const nubesdk = new Command("nubesdk");
	bind(nubesdk);
	const program = new Command();
	program.addCommand(nubesdk);
	return program;
}
