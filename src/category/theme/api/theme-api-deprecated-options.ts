import { Chalk } from "chalk";

const chalk = new Chalk();

/**
 * Emits a one-line yellow warning on stderr when a user passes a deprecated
 * CLI flag. Mirrors the inline notice style used for the `.nube` → `.nuvem`
 * config rename so both transitions feel consistent.
 */
export function warnDeprecatedOption(oldFlag: string, newFlag: string): void {
	process.stderr.write(
		chalk.yellow(
			`Warning: '${oldFlag}' is deprecated. Use '${newFlag}' instead.\n`,
		),
	);
}
