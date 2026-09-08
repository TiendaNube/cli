import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort, isInteractive } from "../../../../interactivity";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
import {
	formatThemeLabel,
	resolveDerivedTitle,
	resolveThemeLabel,
} from "../../theme-title-resolver";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
	addThemePublishedOption,
} from "../theme-api-cli-options";
import { ThemeApiClient } from "../theme-api-client";
import { resolveThemeApiBaseUrl } from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	type UpdateTargets,
	type UpdateTestReport,
	extractThemeIdFromResponse,
	parseUpdateTargets,
	parseUpdateTestReport,
} from "../theme-api-response-parsers";

type UpdateOptions = {
	themeId?: string;
	to?: string;
	title?: string;
	dryRun?: boolean;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	v: boolean;
};

export class ThemeApiInstallationUpdateCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: UpdateOptions,
		command: Command,
	): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;
		const baseUrl = resolveThemeApiBaseUrl({
			configUrl: config.apiBaseUrl,
			cliUrl: options.apiUrl,
		});
		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: config.publicApiToken,
			storeId: config.storeId,
			verbose: options.v,
			extraHeaders,
		});

		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => client,
		});

		// The API decides which versions this theme can move to — it knows whether
		// the theme is forked, what it is pinned to, and which releases are
		// servable. Asking first means the target is picked from real answers
		// instead of typed blind and rejected a round-trip later.
		const available = parseUpdateTargets(
			await client.getUpdateTargets(themeId),
		);

		const target = await this.resolveTarget(command, options, available);
		if (target === null) {
			return;
		}

		// Always dry-run first: the report is what makes the confirmation prompt
		// meaningful, and it costs one read-only call.
		const report = parseUpdateTestReport(
			await client.testUpdateInstallation(themeId, target),
		);

		if (options.dryRun === true) {
			if (options.json) {
				process.stdout.write(
					`${JSON.stringify(this.reportAsJson(themeId, report), null, 2)}\n`,
				);
				return;
			}
			const label = formatThemeLabel(
				await client.getInstallation(themeId),
				themeId,
			);
			for (const line of this.describeReport(label, report)) {
				this.logger.Log(line);
			}
			this.logger.Log("Dry run: nothing was changed.");
			return;
		}

		// One fetch feeds both the source label and the default title, and its
		// title is the base for "<source> (<version>)".
		const installation = await client.getInstallation(themeId);
		const label = formatThemeLabel(installation, themeId);

		// Same title flow as clone: use --title when given, otherwise offer
		// "<source> (<version>)" (prompt to edit when interactive). The version is
		// the report's target — the bare major for a non-forked theme, the exact
		// release for a forked one.
		const title = await resolveDerivedTitle({
			installation,
			provided: options.title,
			command,
			interaction: this.interaction,
			suffix: `(v${report.targetVersion ?? target})`,
			fallback: "Updated draft",
		});

		// clack renders a multi-line message with the gutter on every line, so the
		// report, its conflict-file list, and the question each get their own line
		// instead of being concatenated into one wrapping paragraph.
		const prompt = [
			...this.describeReport(label, report),
			"",
			"Do you want to continue?",
		].join("\n");
		const confirmed = await confirmOrAbort(command, this.interaction, prompt);
		if (!confirmed) {
			return;
		}

		const result = await client.updateInstallation(themeId, target, title);

		if (options.json) {
			process.stdout.write(`${JSON.stringify(result ?? {}, null, 2)}\n`);
			return;
		}
		const newId = extractThemeIdFromResponse(result);
		const newLabel = newId ? await resolveThemeLabel(client, newId) : null;
		const version = report.targetVersion ?? target;
		this.logger.Log(
			newLabel
				? `Theme ${newLabel} was created with version ${version}. Pull the theme to get the updated files.`
				: `A new theme was created with version ${version}. Pull the theme to get the updated files.`,
		);
	}

	/**
	 * The version to update to: `--to` when given, otherwise a pick from the list.
	 * Returns null when there is nothing to do (already current), which is a normal
	 * outcome and not an error.
	 *
	 * `--to` is checked against the same list rather than forwarded blind. The API
	 * would reject a bad value anyway, but it cannot say *which* values are good
	 * for this theme, and "2.1.1 is not one of: 3, 2" is the answer the user needs
	 * — especially since the accepted shape differs by theme: an exact version for
	 * a forked theme, a major for a non-forked one.
	 */
	private async resolveTarget(
		command: Command,
		options: UpdateOptions,
		available: UpdateTargets,
	): Promise<string | null> {
		const from = available.currentVersion ?? "its current version";

		if (available.targets.length === 0) {
			// Only name the version when the API told us one — otherwise the bare
			// "already on the latest version" still reads fine.
			this.logger.Log(
				available.currentVersion
					? `Theme is already on the latest version (v${available.currentVersion}); nothing to update.`
					: "Theme is already on the latest version; nothing to update.",
			);
			return null;
		}

		const requested = options.to?.trim();
		if (requested !== undefined && requested !== "") {
			if (!available.targets.includes(requested)) {
				throw new CliError(
					`${requested} is not a version this theme can update to. Available: ${available.targets.join(", ")}.`,
				);
			}
			return requested;
		}

		if (!isInteractive(command)) {
			throw new CliError(
				`A target version is required (--to). Available: ${available.targets.join(", ")}.`,
			);
		}

		// A forked theme offers exact versions, a non-forked one bare majors, but
		// the prompt stays the same either way — the caller picks from the list,
		// no need to make them reason about which kind they have.
		return this.interaction.Select(
			`Update to which version? (currently ${from})`,
			available.targets.map((v) => ({ value: v })),
		);
	}

	private reportAsJson(
		themeId: string,
		report: UpdateTestReport,
	): Record<string, unknown> {
		return {
			theme_id: themeId,
			current_version: report.baselineVersion,
			target_version: report.targetVersion,
			conflicts: report.conflictingFiles.length,
			conflicting_files: report.conflictingFiles,
		};
	}

	/**
	 * Human-readable summary, shared by `--dry-run` output and the prompt. The
	 * conflict block is emitted only when there are conflicts; a clean update is
	 * just the two-line "what will happen" summary.
	 */
	private describeReport(
		themeLabel: string,
		report: UpdateTestReport,
	): string[] {
		const from = report.baselineVersion ?? "its current version";
		const to = report.targetVersion ?? "the target version";
		const lines = [
			`Updating from ${from} to ${to}.`,
			`The update creates a new draft, the theme ${themeLabel} is left untouched.`,
		];

		const count = report.conflictingFiles.length;
		if (count > 0) {
			lines.push(
				"",
				"Files with conflicts will be replaced with the new version ones.",
				"",
				`${count} ${count === 1 ? "conflict" : "conflicts"} found:`,
			);
			for (const path of report.conflictingFiles) {
				lines.push(`  - ${path}`);
			}
		}
		return lines;
	}

	Bind(command: Command): void {
		const updateCmd = command
			.command("update")
			.description(
				"Update a theme to a newer version of its base theme, as a new draft",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			);
		updateCmd
			// Not a required-option-with-prompt: the valid answers come from the API
			// (they differ per theme), so the prompt is a pick from that list, built
			// in Execute once the targets are known — see resolveTarget.
			.option(
				"--to <version>",
				'Target version. A forked theme takes an exact version ("2.3.1"), a non-forked one a major ("2"). Omit to choose from the available versions.',
			)
			.option(
				"--title <title>",
				"Title for the new theme (defaults to '<source> (<version>)')",
			)
			.option(
				"--dry-run",
				"Only report which local edits the update would discard",
				false,
			);
		addThemePublishedOption(updateCmd);
		addThemeApiTokenOption(updateCmd);
		addHiddenThemeApiUrlOption(updateCmd);
		addHiddenThemeApiHeaderOption(updateCmd);
		updateCmd
			.option("--json", "Use machine-readable JSON output", false)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((opts: UpdateOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
