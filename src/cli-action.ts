import type { Command } from "commander";
import { CliLogger } from "./cli-logger";
import { CommandTelemetry } from "./telemetry/telemetry";

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
 * Commander passes the `Command` instance as the last action-handler argument,
 * after any operands and the parsed options. Detected structurally so a handler
 * with a different arity still reports the right command path.
 */
function commandFromActionArgs(args: unknown[]): Command | undefined {
	const last = args.at(-1);
	if (typeof last !== "object" || last === null) {
		return undefined;
	}
	const candidate = last as { name?: unknown; opts?: unknown };
	return typeof candidate.name === "function" &&
		typeof candidate.opts === "function"
		? (last as Command)
		: undefined;
}

/**
 * Wraps a Commander action handler so that any thrown error results in a
 * non-zero exit code and is logged exactly once. Handlers should simply throw
 * (a `CliError` for expected failures) on error and return on success; they
 * must not set `process.exitCode` themselves.
 *
 * Uses `process.exitCode` rather than `process.exit()` so stdout/stderr can
 * flush and long-running commands (watch) are not killed abruptly.
 *
 * Also the single instrumentation point for usage telemetry: every command action
 * and every failure already passes through here, so nothing needs to be added
 * per command. `Begin` is synchronous and inside the `try`, so instrumenting a
 * command neither delays nor can break it.
 */
export function runAction<A extends unknown[]>(
	fn: (...args: A) => Promise<void> | void,
): (...args: A) => Promise<void> {
	return async (...args: A) => {
		const logger = new CliLogger();
		const telemetry = new CommandTelemetry();
		try {
			telemetry.Begin(commandFromActionArgs(args));
			await fn(...args);
			telemetry.Finish("success");
		} catch (err) {
			if (isCancellation(err)) {
				logger.Warn(
					err instanceof Error ? err.message : "Operation cancelled.",
				);
				process.exitCode = 130; // conventional SIGINT exit code
				telemetry.Finish("cancelled", err);
				return;
			}
			logger.Error(err instanceof Error ? err.message : String(err));
			process.exitCode = 1;
			telemetry.Finish("error", err);
		}
	};
}
