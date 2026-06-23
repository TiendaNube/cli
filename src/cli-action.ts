import { CliLogger } from "./cli-logger";

/** Ordinary command failure carrying an already user-facing message. */
export class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

/** User aborted an interactive prompt (Ctrl-C / clack cancel symbol). */
export class CancelError extends Error {
	constructor(message = "Operation cancelled.") {
		super(message);
		this.name = "CancelError";
	}
}

function isCancellation(err: unknown): boolean {
	return (
		err instanceof CancelError ||
		(err as { name?: string } | null)?.name === "ExitPromptError"
	);
}

/**
 * Wraps a Commander action handler so that any thrown error results in a
 * non-zero exit code and is logged exactly once. Handlers should simply throw
 * (a `CliError` for expected failures) on error and return on success; they
 * must not set `process.exitCode` themselves.
 *
 * Uses `process.exitCode` rather than `process.exit()` so stdout/stderr can
 * flush and long-running commands (watch) are not killed abruptly.
 */
export function runAction<A extends unknown[]>(
	fn: (...args: A) => Promise<void> | void,
): (...args: A) => Promise<void> {
	return async (...args: A) => {
		const logger = new CliLogger();
		try {
			await fn(...args);
		} catch (err) {
			if (isCancellation(err)) {
				logger.Warn(
					err instanceof Error ? err.message : "Operation cancelled.",
				);
				process.exitCode = 130; // conventional SIGINT exit code
				return;
			}
			logger.Error(err instanceof Error ? err.message : String(err));
			process.exitCode = 1;
		}
	};
}
