import type { Command } from "commander";
import { CliError } from "./cli-action";
import type { CliInteraction } from "./cli-interaction";

function isTruthyEnv(value: string | undefined): boolean {
	return (
		value !== undefined &&
		value !== "" &&
		value !== "0" &&
		value.toLowerCase() !== "false"
	);
}

/** Reads the global `--yes` flag, merged from the root command, for any subcommand. */
export function yesFlagSet(cmd?: Command): boolean {
	return cmd?.optsWithGlobals().yes === true;
}

/** May prompt only when stdin/stdout are real TTYs, not CI, and `--yes` is absent. */
export function isInteractive(cmd?: Command): boolean {
	if (yesFlagSet(cmd)) return false;
	if (isTruthyEnv(process.env.CI)) return false;
	return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/**
 * Resolves a destructive confirmation uniformly:
 * - `--yes` set => proceed without asking.
 * - non-interactive (CI / no TTY) without `--yes` => abort with a clear error.
 * - real TTY => ask the user.
 */
export async function confirmOrAbort(
	cmd: Command,
	interaction: CliInteraction,
	message: string,
): Promise<boolean> {
	if (yesFlagSet(cmd)) return true;
	if (!isInteractive(cmd)) {
		throw new CliError(
			"Destructive operation requires confirmation. Re-run with --yes in non-interactive mode.",
		);
	}
	return interaction.Confirm(message);
}
