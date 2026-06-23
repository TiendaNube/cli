import type { Command } from "commander";
import { CliError } from "../../cli-action";
import { getCliExecutableName } from "../../cli-executable-name";
import { promptForMissingValue } from "../../cli-required-option";
import { isInteractive } from "../../interactivity";
import { validateThemeId } from "./api/theme-api-prompt-validators";
import {
	type ThemeApiConfig,
	resolveThemeIdWithProductive,
} from "./theme-workspace-types";

/**
 * Single source of truth for resolving a concrete theme id across the theme-api
 * commands: flag (`--theme-id`/`--installation-id`) → `--published` (productive
 * theme) → `.nuvem` config → interactive prompt. Always returns a concrete id
 * or throws `CliError`.
 */
export async function resolveThemeIdOrFail(args: {
	cmd: Command;
	options: { themeId?: string; installationId?: string; published?: boolean };
	config: ThemeApiConfig | undefined;
	getClient: () => { listInstallations: () => Promise<unknown> };
	/** Whether the command exposes `--published` (tailors the error hint). */
	supportsPublished?: boolean;
}): Promise<string> {
	const { cmd, options, config, getClient, supportsPublished = true } = args;
	let themeId = await resolveThemeIdWithProductive({
		options: {
			themeId: options.themeId ?? options.installationId,
			published: options.published,
		},
		config,
		getClient,
	});
	if (!themeId && !options.published && isInteractive(cmd)) {
		themeId =
			(await promptForMissingValue(
				"Enter theme-id:",
				{ validate: validateThemeId },
				cmd,
			)) ?? null;
	}
	if (!themeId) {
		const cli = getCliExecutableName();
		const publishedHint = supportsPublished ? "use --published, " : "";
		throw new CliError(
			`No theme id: pass --theme-id, ${publishedHint}or run ${cli} theme pull --theme-id <id> (saves to .nuvem).`,
		);
	}
	// Validate the resolved id regardless of source (flag, .nuvem, productive, prompt).
	const themeIdError = validateThemeId(themeId);
	if (themeIdError) throw new CliError(themeIdError);
	return themeId;
}
