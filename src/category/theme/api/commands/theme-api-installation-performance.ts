import type { Command } from "commander";
import { Option } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
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
import { runThemePerformanceAudits } from "../theme-api-lighthouse";
import {
	PERFORMANCE_DEVICES,
	type PerformanceDevice,
	type ThemePerformanceReport,
	extractThemePerformanceReport,
	formatThemePerformanceReportsHuman,
	formatThemePerformanceReportsJson,
} from "../theme-api-performance-report";
import { buildThemeInstallationPreviewUrl } from "../theme-api-preview-url";

type DeviceOption = "both" | PerformanceDevice;

type PerformanceOptions = {
	themeId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	json: boolean;
	detailed: boolean;
	device: DeviceOption;
};

export class ThemeApiInstallationPerformanceCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(
		options: PerformanceOptions,
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
		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => {
				const baseUrl = resolveThemeApiBaseUrl({
					configUrl: config.apiBaseUrl,
					cliUrl: options.apiUrl,
				});
				const extraHeaders = resolveExtraHeadersFromCli(
					options.header,
					this.logger,
				);
				return new ThemeApiClient({
					apiBaseUrl: baseUrl,
					publicApiToken: config.publicApiToken,
					storeId: config.storeId,
					verbose: false,
					extraHeaders,
				});
			},
		});

		const storeUrl = config.storeUrl?.trim();
		if (!storeUrl) {
			const cli = getCliExecutableName();
			throw new CliError(
				`No store_url in .nuvem: re-run ${cli} theme authorize to save your storefront URL (e.g. https://your-store.nuvemshop.com.br).`,
			);
		}

		const url = buildThemeInstallationPreviewUrl(storeUrl, themeId);

		const devices: PerformanceDevice[] =
			options.device === "both" ? [...PERFORMANCE_DEVICES] : [options.device];

		// Only human output narrates progress; JSON output keeps stdout to the
		// machine-readable payload alone.
		if (!options.json) {
			const label =
				options.device === "both" ? "mobile and desktop" : options.device;
			this.logger.Log(`Analyzing theme performance (${label}) at ${url}`);
			this.logger.Log("This can take a minute…");
		}

		let audits: Awaited<ReturnType<typeof runThemePerformanceAudits>>;
		try {
			audits = await runThemePerformanceAudits(url, devices);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new CliError(`Performance analysis failed: ${msg}`);
		}

		const reports: ThemePerformanceReport[] = audits.map((audit) =>
			extractThemePerformanceReport(audit.lhr, {
				device: audit.device,
				themeId,
				url,
			}),
		);

		if (options.json) {
			process.stdout.write(
				formatThemePerformanceReportsJson(reports, {
					detailed: options.detailed,
				}),
			);
			return;
		}
		process.stdout.write(
			formatThemePerformanceReportsHuman(reports, {
				detailed: options.detailed,
			}),
		);
	}

	Bind(command: Command): void {
		const performanceCmd = command
			.command("performance")
			.description(
				"Run a Lighthouse performance report on the current version of the theme",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			);
		addThemePublishedOption(performanceCmd);
		addThemeApiTokenOption(performanceCmd);
		addHiddenThemeApiUrlOption(performanceCmd);
		addHiddenThemeApiHeaderOption(performanceCmd);
		performanceCmd
			.addOption(
				new Option("--device <device>", "Which form factor(s) to audit")
					.choices(["both", "mobile", "desktop"])
					.default("both"),
			)
			.option("--json", "Use machine-readable JSON output", false)
			.option(
				"--detailed",
				"Include recommended changes from the Lighthouse report",
				false,
			)
			.action(
				runAction((opts: PerformanceOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
