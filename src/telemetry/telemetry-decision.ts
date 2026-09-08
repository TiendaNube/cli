import {
	type TelemetryConfig,
	type TelemetryConfigManager,
	newInstallId,
} from "./telemetry-config";
import {
	isContinuousIntegration,
	isTelemetryDisabledByEnvironment,
	resolveTelemetryEnabledOverride,
} from "./telemetry-settings";

/**
 * Whether the reporting identity survives this run.
 *
 * `ephemeral` means the id was minted for this invocation only and will never be
 * seen again, so the run counts as activity but not as a person. Charts that count
 * *users* — active users, retention, version adoption — must filter to
 * `persistent`; that condition is stricter than `is_ci = false` and is the one to
 * rely on.
 */
export type TelemetryIdentityKind = "persistent" | "ephemeral";

export type TelemetryDecision = {
	enabled: boolean;
	installId?: string;
	identity?: TelemetryIdentityKind;
};

const TELEMETRY_DISABLED: TelemetryDecision = { enabled: false };

/** Reports without leaving anything behind on disk. */
function ephemeralDecision(): TelemetryDecision {
	return { enabled: true, installId: newInstallId(), identity: "ephemeral" };
}

/** Why telemetry is on or off, in words `telemetry status` can print. */
export type TelemetryResolution =
	| { outcome: "off"; reason: string }
	| {
			outcome: "on";
			reason: string;
			identity: TelemetryIdentityKind;
			installId?: string;
	  };

/**
 * The effective state, derived without reading or writing anything.
 *
 * Shared by `resolveTelemetryDecision` and `telemetry status` so the two can
 * never disagree about whether data is being sent — which matters most in CI and
 * under an env var, where `status` is the only way to check.
 *
 * `status` prints these reasons verbatim, so they name a variable the CLI really
 * reads. Only the `TIENDANUBE_` spelling is named: the `NUVEMSHOP_` alias works
 * identically, and printing both would leave a user guessing which one to set.
 *
 * A `persistent` outcome carries no `installId` on the first run of a machine: the
 * id does not exist yet, and minting it is a write, which `status` must not do.
 */
export function resolveTelemetryState(params: {
	stored: TelemetryConfig | null;
	env: Record<string, string | undefined>;
}): TelemetryResolution {
	const { stored, env } = params;

	const override = resolveTelemetryEnabledOverride(env);
	if (override === false) {
		return {
			outcome: "off",
			reason: "turned off by TIENDANUBE_CLI_TELEMETRY_ENABLED=0",
		};
	}

	const disabledByEnv = isTelemetryDisabledByEnvironment(env);
	const optedOut = stored !== null && !stored.telemetryEnabled;

	if (disabledByEnv || optedOut) {
		// `..._TELEMETRY_ENABLED=1` is the way back on without editing the config, and
		// it reports with a throwaway identity on purpose: an env var is a property of
		// an environment, not a decision that should outlive it, so nothing is written
		// and the stored opt-out returns the moment the variable is unset.
		if (override === true) {
			return {
				outcome: "on",
				reason: "turned on by TIENDANUBE_CLI_TELEMETRY_ENABLED=1",
				identity: "ephemeral",
			};
		}
		return {
			outcome: "off",
			reason: disabledByEnv
				? "turned off by DO_NOT_TRACK or TIENDANUBE_CLI_TELEMETRY_DISABLED"
				: "you opted out on this machine",
		};
	}

	// A stored identity outranks the CI default: a self-hosted runner where someone
	// opted in is a machine that really does keep an id across runs.
	if (stored?.installId !== undefined) {
		return {
			outcome: "on",
			reason: "on for this machine",
			identity: "persistent",
			installId: stored.installId,
		};
	}

	if (isContinuousIntegration(env)) {
		// The identity is per-run because a container cannot keep one, which is exactly
		// why user-based charts must exclude it — and why nothing is written here.
		return {
			outcome: "on",
			reason: "CI runs report with a per-run id",
			identity: "ephemeral",
		};
	}

	return {
		outcome: "on",
		reason: stored !== null ? "on for this machine" : "collected by default",
		identity: "persistent",
	};
}

/**
 * Resolves whether this invocation may report telemetry.
 *
 * Precedence, first match wins:
 *
 *  1. `..._TELEMETRY_ENABLED=0` — off anywhere, no exceptions.
 *  2. `DO_NOT_TRACK` / `..._TELEMETRY_DISABLED`, or an opt-out stored on this
 *     machine — off, unless `..._TELEMETRY_ENABLED=1` forces reporting back on.
 *  3. An id already stored on this machine — on, with that id, CI or not: a
 *     self-hosted runner someone opted in on does keep an identity.
 *  4. CI — on, with a per-run identity and nothing written to disk.
 *  5. Anything else — on, with a persistent anonymous id, minted on first use.
 *
 * Collection is on by default and nobody is asked: the payload is anonymous by
 * construction — enforced in `describeError` and `buildCommandEvent`, not merely
 * promised — and opting out is one documented command away. Environment variables
 * are never written to the config file, so unsetting one always restores whatever
 * the user actually chose.
 *
 * Synchronous by design. There is nothing to await, so instrumenting a command can
 * never reorder the work that command dispatches.
 */
export function resolveTelemetryDecision(params: {
	configManager: TelemetryConfigManager;
	env?: Record<string, string | undefined>;
}): TelemetryDecision {
	const { configManager, env = process.env } = params;

	const resolution = resolveTelemetryState({
		stored: configManager.Load(),
		env,
	});

	if (resolution.outcome === "off") {
		return TELEMETRY_DISABLED;
	}
	if (resolution.installId !== undefined) {
		return {
			enabled: true,
			installId: resolution.installId,
			identity: resolution.identity,
		};
	}
	if (resolution.identity === "ephemeral") {
		return ephemeralDecision();
	}

	return mintPersistentIdentity(configManager);
}

/**
 * Creates the machine's anonymous id on first use.
 *
 * An id that cannot be stored would differ on every run, turning one developer
 * into a new "daily user" each time. Reporting as explicitly `ephemeral` instead
 * still counts the run as activity while keeping it out of every user-based chart,
 * which is the honest answer for a machine we will not recognise again.
 */
function mintPersistentIdentity(
	configManager: TelemetryConfigManager,
): TelemetryDecision {
	const installId = newInstallId();

	if (
		!configManager.Save({
			telemetryEnabled: true,
			installId,
		})
	) {
		return ephemeralDecision();
	}

	return { enabled: true, installId, identity: "persistent" };
}
