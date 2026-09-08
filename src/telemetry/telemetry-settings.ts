import { isTruthyEnv } from "../interactivity";

/** Amplitude HTTP V2 ingestion endpoint, US data region. Not a secret. */
export const AMPLITUDE_HTTP_V2_ENDPOINT =
	"https://api2.amplitude.com/2/httpapi";

/** Env var carrying the Amplitude ingestion key, at build time and at runtime alike. */
export const AMPLITUDE_API_KEY_ENV_VAR = "TIENDANUBE_CLI_AMPLITUDE_API_KEY";

/**
 * Replaced at build time by the tsup `define` in `tsup.config.js`, which reads the
 * CircleCI context variable of the same name.
 *
 * Only the *name* lives in source — this file is mirrored verbatim to the public
 * `TiendaNube/cli` repo, while the value exists solely in CI and in the built
 * `dist/` bundle, which is gitignored and excluded from the mirror allowlist.
 *
 * Declared but never bundled: under vitest or a plain `tsc` run the identifier
 * does not exist at all, which `typeof` handles without throwing, leaving
 * telemetry inert.
 */
declare const __TIENDANUBE_CLI_AMPLITUDE_API_KEY__: string | undefined;

/**
 * The ingestion key, or an empty string when telemetry is not configured — which
 * is the normal state for local builds, public-repo clones and the test suite.
 */
export function resolveAmplitudeApiKey(
	env: Record<string, string | undefined> = process.env,
): string {
	// Runtime override first, so the pipeline can be exercised locally without a rebuild.
	const fromEnv = env[AMPLITUDE_API_KEY_ENV_VAR]?.trim();
	if (fromEnv !== undefined && fromEnv.length > 0) {
		return fromEnv;
	}

	return typeof __TIENDANUBE_CLI_AMPLITUDE_API_KEY__ === "string"
		? __TIENDANUBE_CLI_AMPLITUDE_API_KEY__.trim()
		: "";
}

/**
 * Tri-state read: `undefined` when unset or blank, otherwise the boolean value.
 * A blank variable counts as unset, which is what `VAR=` in a shell or a CI config
 * conventionally means.
 */
function readBooleanEnv(value: string | undefined): boolean | undefined {
	if (value === undefined || value.trim().length === 0) {
		return undefined;
	}
	return isTruthyEnv(value);
}

/**
 * The explicit `..._TELEMETRY_ENABLED` override, which wins over every other
 * signal in both directions: `=0` forces reporting off anywhere, `=1` forces it
 * back on anywhere something else — `DO_NOT_TRACK`, or a stored opt-out — turned
 * it off.
 *
 * Both bin-name prefixes are accepted because the CLI ships as `tiendanube` and
 * `nuvemshop`, and a user should not have to know which one owns the env var.
 * A conflicting pair resolves to off, so the safer intent wins.
 */
export function resolveTelemetryEnabledOverride(
	env: Record<string, string | undefined> = process.env,
): boolean | undefined {
	const values = [
		readBooleanEnv(env.TIENDANUBE_CLI_TELEMETRY_ENABLED),
		readBooleanEnv(env.NUVEMSHOP_CLI_TELEMETRY_ENABLED),
	].filter((value): value is boolean => value !== undefined);

	if (values.length === 0) {
		return undefined;
	}
	return values.every((value) => value);
}

/**
 * Honors `DO_NOT_TRACK` (the cross-tool convention) plus the CLI-specific
 * `..._TELEMETRY_DISABLED` aliases, under either bin-name prefix. These win over a
 * stored opt-in but lose to an explicit `..._TELEMETRY_ENABLED=1`.
 */
export function isTelemetryDisabledByEnvironment(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return (
		isTruthyEnv(env.DO_NOT_TRACK) ||
		isTruthyEnv(env.TIENDANUBE_CLI_TELEMETRY_DISABLED) ||
		isTruthyEnv(env.NUVEMSHOP_CLI_TELEMETRY_DISABLED)
	);
}

/** Keeps the ~40 spec files from writing to a real HOME or sending events. */
export function isTestEnvironment(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return isTruthyEnv(env.VITEST) || env.NODE_ENV === "test";
}

/** Tagged on every event so CI runs can be filtered out of the DAU chart. */
export function isContinuousIntegration(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return isTruthyEnv(env.CI);
}
