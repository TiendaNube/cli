import type { Command } from "commander";
import { Option } from "commander";

/**
 * Registers `--token <token>` so the command can authenticate with a Base64
 * payload (same shape as `theme authorize`) instead of `.nuvem`. Visible in
 * `--help`.
 */
export function addThemeApiTokenOption(command: Command): void {
	command.option(
		"--token <token>",
		"Authentication token (same format as 'theme authorize'); overrides .nuvem for this run only",
	);
}

/**
 * Registers `--published`, a boolean flag that resolves the store's
 * productive theme via the API instead of using `--theme-id` or `.nuvem`.
 * Visible in `--help`.
 */
export function addThemePublishedOption(command: Command): void {
	command.option(
		"--published",
		"Use the store's published theme (resolved via API)",
		false,
	);
}

/**
 * Registers `--api-url` without listing it in `--help` (internal / staging overrides).
 * Parsing behavior is unchanged.
 */
export function addHiddenThemeApiUrlOption(command: Command): void {
	command.addOption(
		new Option(
			"--api-url <api_url>",
			"Override Public API base URL for this command",
		).hideHelp(),
	);
}

/**
 * Registers `--authorize-url` without listing it in `--help` (internal / staging overrides).
 */
export function addHiddenThemeAuthorizeUrlOption(command: Command): void {
	command.addOption(
		new Option(
			"--authorize-url <authorize_url>",
			"Override authorize URL for this command",
		).hideHelp(),
	);
}

/**
 * Registers a repeatable `--header "Key: Value"` flag for adding custom headers
 * to every request issued by the command. Hidden from `--help`.
 */
export function addHiddenThemeApiHeaderOption(command: Command): void {
	command.addOption(
		new Option(
			"--header <header>",
			'Add a custom header "Key: Value" to every request (repeatable)',
		)
			.argParser((value: string, previous: string[] = []) => [
				...previous,
				value,
			])
			.default([] as string[])
			.hideHelp(),
	);
}
