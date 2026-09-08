import type { Command } from "commander";
import { TelemetryClient } from "./telemetry-client";
import { TelemetryConfigManager } from "./telemetry-config";
import {
	type TelemetryDecision,
	resolveTelemetryDecision,
} from "./telemetry-decision";
import {
	type TelemetryCommandStatus,
	buildCommandEvent,
	describeError,
	resolveCommandPath,
} from "./telemetry-event";
import {
	isContinuousIntegration,
	isTestEnvironment,
	resolveAmplitudeApiKey,
} from "./telemetry-settings";

/**
 * The telemetry controls themselves, which are never reported.
 *
 * `telemetry disable` must not mint an identity for a machine on its way out and
 * send an event about it, and `status` must not be the thing that creates the id
 * it reports.
 */
const TELEMETRY_CONTROL_PATH = "telemetry";

/**
 * Telemetry for a single command invocation, driven entirely from `runAction` —
 * the one place that already wraps every command action and catches every error.
 */
export class CommandTelemetry {
	private startedAtMs = Date.now();
	private decision: TelemetryDecision = { enabled: false };
	private commandPath = "unknown";

	/**
	 * Settles whether this run reports, before the command body starts.
	 *
	 * Synchronous, and deliberately so: nothing here prompts or awaits, so wrapping
	 * a command cannot reorder the work that command dispatches — commands that fan
	 * out in parallel are observably sensitive to an extra microtask.
	 */
	Begin(command: Command | undefined): void {
		this.commandPath = resolveCommandPath(command);

		if (this.IsReportable()) {
			this.decision = resolveTelemetryDecision({
				configManager: new TelemetryConfigManager(),
			});
		}

		this.startedAtMs = Date.now();
	}

	private IsReportable(): boolean {
		if (isTestEnvironment()) {
			return false;
		}
		// Without a key there is nothing to send, so resolving a decision would only
		// create an id for events that never leave the machine. This is the normal
		// state for local builds and for clones of the public repo.
		if (resolveAmplitudeApiKey().length === 0) {
			return false;
		}
		if (this.commandPath.startsWith(TELEMETRY_CONTROL_PATH)) {
			return false;
		}
		return true;
	}

	/**
	 * Records the outcome. Fire-and-forget by design: see `TelemetryClient.Send`
	 * for why the request is not awaited.
	 */
	Finish(status: TelemetryCommandStatus, error?: unknown): void {
		const { installId, identity } = this.decision;
		if (!this.decision.enabled || installId === undefined) {
			return;
		}

		try {
			const event = buildCommandEvent({
				installId,
				identity: identity ?? "ephemeral",
				command: this.commandPath,
				status,
				durationMs: Date.now() - this.startedAtMs,
				isCi: isContinuousIntegration(),
				...(error !== undefined ? { error: describeError(error) } : {}),
				now: Date.now(),
			});
			void new TelemetryClient(resolveAmplitudeApiKey()).Send([event]);
		} catch {
			// Never let reporting an outcome change the outcome.
			return;
		}
	}
}
