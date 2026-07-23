import type { Command } from "commander";
import type { CliInteraction } from "../../cli-interaction";
import { isInteractive } from "../../interactivity";
import type { ThemeApiClient } from "./api/theme-api-client";
import { mapInstallationToTableFields } from "./api/theme-api-response-parsers";

/**
 * Single source of truth for resolving the title of a new theme derived from a
 * source installation (clone, unfork). When the caller passed `--title`, use it.
 * Otherwise default to "<source title> <suffix>" (e.g. "My Theme (copy)"), or
 * the source title alone when no suffix is given, falling back to `fallback`
 * when the source has no title: prompt with that
 * default pre-filled when interactive, or use it directly otherwise.
 */
export async function resolveDerivedTitle(args: {
	client: ThemeApiClient;
	themeId: string;
	provided: string | undefined;
	command: Command;
	interaction: CliInteraction;
	/**
	 * Suffix appended to the source title, e.g. "(copy)" or "(unforked)".
	 * When omitted, the source title is used as-is.
	 */
	suffix?: string;
	/** Default used when the source installation has no title. */
	fallback: string;
}): Promise<string> {
	const { client, themeId, provided, command, interaction, suffix, fallback } =
		args;

	const explicit = provided?.trim();
	if (explicit) {
		return explicit;
	}

	const source = mapInstallationToTableFields(
		await client.getInstallation(themeId),
	);
	const sourceTitle = source.title.trim();
	const defaultTitle = sourceTitle
		? suffix
			? `${sourceTitle} ${suffix}`
			: sourceTitle
		: fallback;

	if (!isInteractive(command)) {
		return defaultTitle;
	}

	const answer = await interaction.Input("Title for the new theme", {
		initialValue: defaultTitle,
	});
	return answer.trim() || defaultTitle;
}
