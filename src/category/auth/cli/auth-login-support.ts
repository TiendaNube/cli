import { CliError } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import type { CliLogger } from "../../../cli-logger";
import { normalizeAlias, validateAliasFlag } from "../domain/auth-alias";

/** `--alias` as given on a login command, validated, or `undefined`. */
export function aliasFromFlag(raw: string | undefined): string | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const alias = normalizeAlias(raw);
	const error = validateAliasFlag(alias);
	if (error !== undefined) {
		throw new CliError(error);
	}
	return alias;
}

export function logLoginOutcome(params: {
	logger: CliLogger;
	alias: string;
	filePath: string;
	linked: boolean;
	nextCommands: string;
}): void {
	const bin = getCliExecutableName();
	params.logger.Log(
		`Credential "${params.alias}" saved to ${params.filePath}.`,
	);
	if (params.linked) {
		params.logger.Log(
			`This folder now uses "${params.alias}". Next: ${bin} ${params.nextCommands}.`,
		);
		return;
	}
	params.logger.Log(
		`This folder was not linked. In your theme folder, run ${bin} auth link --alias ${params.alias}, or pass --alias ${params.alias} to any theme command.`,
	);
}
