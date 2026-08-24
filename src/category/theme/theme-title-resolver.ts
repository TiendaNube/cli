import type { Command } from "commander";
import type { CliInteraction } from "../../cli-interaction";
import { isInteractive } from "../../interactivity";
import type { ThemeApiClient } from "./api/theme-api-client";
import { mapInstallationToTableFields } from "./api/theme-api-response-parsers";

/**
 * "'<title>' (<id>)" for user-facing messages, from an installation body the
 * caller already fetched — falling back to the bare id when it has no title.
 * Pure: no request. Fetching the installation first is what proves it exists, so
 * a command can fail early (before a destructive confirm) rather than swallow a
 * 404 here; this only formats what that fetch returned.
 */
export function formatThemeLabel(
	installation: unknown,
	themeId: string,
): string {
	const title = mapInstallationToTableFields(installation).title.trim();
	return title ? `'${title}' (${themeId})` : themeId;
}

/**
 * Best-effort "<title> (<id>)" when the caller has only an id and no fetched
 * installation — used for a theme that was just created, where the operation
 * already succeeded and a label lookup is not worth failing the command over.
 * For a theme whose existence the command should validate, fetch it and use
 * {@link formatThemeLabel} instead.
 */
export async function resolveThemeLabel(
	client: ThemeApiClient,
	themeId: string,
): Promise<string> {
	try {
		return formatThemeLabel(await client.getInstallation(themeId), themeId);
	} catch {
		return themeId;
	}
}

/**
 * Single source of truth for resolving the title of a new theme derived from a
 * source installation (clone, unfork, update). When the caller passed `--title`,
 * use it. Otherwise default to "<source title> <suffix>" (e.g. "My Theme
 * (copy)"), or the source title alone when no suffix is given, falling back to
 * `fallback` when the source has no title: prompt with that default pre-filled
 * when interactive, or use it directly otherwise.
 *
 * The source installation body is a prerequisite — the caller fetches it first
 * (which is also what proves the source exists before anything is created) and
 * hands it in, so this resolver issues no request of its own.
 */
export async function resolveDerivedTitle(args: {
	/** The source installation body the caller already fetched. */
	installation: unknown;
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
	const { installation, provided, command, interaction, suffix, fallback } =
		args;

	const explicit = provided?.trim();
	if (explicit) {
		return explicit;
	}

	const source = mapInstallationToTableFields(installation);
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
