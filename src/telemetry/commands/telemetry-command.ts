import type { Command } from "commander";
import { CliError, runAction } from "../../cli-action";
import { getCliExecutableName } from "../../cli-executable-name";
import { CliLogger } from "../../cli-logger";
import { TelemetryConfigManager, newInstallId } from "../telemetry-config";
import {
	type TelemetryResolution,
	resolveTelemetryState,
} from "../telemetry-decision";
import { resolveAmplitudeApiKey } from "../telemetry-settings";

/** How the reported id should be described in `status`. */
function describeIdentity(
	resolution: Extract<TelemetryResolution, { outcome: "on" }>,
): string {
	if (resolution.identity === "ephemeral") {
		return "generated per run, never stored";
	}
	return (
		resolution.installId ??
		"not created yet — the next command will generate one"
	);
}

/**
 * User-facing control over telemetry.
 *
 * Discoverable commands rather than documentation-only env vars: collection is on
 * by default, so opting out has to be something a user can find from `--help`.
 */
export class TelemetryCommands {
	private logger = new CliLogger();

	public constructor(
		private readonly configManager: TelemetryConfigManager = new TelemetryConfigManager(),
	) {}

	Bind(program: Command): void {
		const telemetry = program
			.command("telemetry")
			.description(
				"Inspect or change anonymous usage-data collection for this CLI",
			);

		telemetry
			.command("status")
			.description("Show whether anonymous usage data is being collected")
			.action(runAction(() => this.Status()));

		telemetry
			.command("enable")
			.description("Enable anonymous usage-data collection")
			.action(runAction(() => this.Enable()));

		telemetry
			.command("disable")
			.description("Disable anonymous usage-data collection")
			.action(runAction(() => this.Disable()));
	}

	private Status(): void {
		if (resolveAmplitudeApiKey().length === 0) {
			this.logger.Warn(
				"Telemetry is not configured in this build: no events are sent, regardless of the state below.",
			);
		}

		// Reports the *effective* state, not just what is on disk: with collection on
		// by default there is nothing stored until something changes it, and in CI or
		// under an env var `status` is the only way to check.
		const resolution = resolveTelemetryState({
			stored: this.configManager.Load(),
			env: process.env,
		});

		this.logger.Log(`Telemetry: ${resolution.outcome} — ${resolution.reason}`);

		if (resolution.outcome === "on") {
			this.logger.Log(`Anonymous id: ${describeIdentity(resolution)}`);
			this.logger.Log(
				`Opt out with: ${getCliExecutableName()} telemetry disable`,
			);
		}

		this.logger.Log(`Config file: ${this.configManager.FilePath}`);
	}

	private Enable(): void {
		const stored = this.configManager.Load();
		const installId = stored?.installId ?? newInstallId();

		// Thrown rather than logged: `runAction` reports it and sets a non-zero exit
		// status, so a script that flips the setting can tell that it did not stick.
		if (!this.configManager.Save({ telemetryEnabled: true, installId })) {
			throw new CliError(
				`Could not write ${this.configManager.FilePath}. The previous setting is unchanged.`,
			);
		}

		this.logger.Log("Telemetry enabled. Thank you — this helps us prioritise.");
	}

	private Disable(): void {
		// The stored id is dropped rather than kept for later: opting out should
		// leave no identifier behind. It also makes `disable` + `enable` the way to
		// rotate the id, which is why there is no separate command for that.
		if (!this.configManager.Save({ telemetryEnabled: false })) {
			throw new CliError(
				`Could not write ${this.configManager.FilePath}. Telemetry has not been disabled.`,
			);
		}

		this.logger.Log("Telemetry disabled. No usage data will be sent.");
	}
}
