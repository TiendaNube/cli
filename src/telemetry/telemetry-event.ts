import os from "node:os";
import type { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import type { TelemetryIdentityKind } from "./telemetry-decision";

/** Single event type, with the command as a property — see `resolveCommandPath`. */
export const TELEMETRY_COMMAND_EVENT = "cli_command_executed";

export type TelemetryCommandStatus = "success" | "error" | "cancelled";

export type TelemetryErrorFacts = {
	errorType: string;
	errorCode?: string;
	httpStatus?: number;
};

export type AmplitudeEvent = {
	event_type: string;
	device_id: string;
	time: number;
	app_version: string;
	os_name: string;
	os_version: string;
	platform: string;
	ip: string;
	event_properties: Record<string, string | number | boolean>;
};

/**
 * Duration buckets, as a fallback for percentile aggregation on `duration_ms`,
 * which is not available on every Amplitude plan. A plain group-by on this always
 * gives the shape of the distribution.
 *
 * Labels are numbered because Amplitude sorts group-by values lexicographically:
 * without the prefix, "1-5m" would sort before "5-15s" and the chart would read as
 * nonsense. Do not "tidy" the prefixes away.
 *
 * The range runs to minutes because `theme performance` drives Lighthouse and
 * `theme watch` is a session that can last hours.
 */
const DURATION_BUCKET_FASTEST = "1: <1s";
const DURATION_BUCKET_OVERFLOW = "6: >5m";

const DURATION_BUCKETS: ReadonlyArray<{ belowMs: number; label: string }> = [
	{ belowMs: 1_000, label: DURATION_BUCKET_FASTEST },
	{ belowMs: 5_000, label: "2: 1-5s" },
	{ belowMs: 15_000, label: "3: 5-15s" },
	{ belowMs: 60_000, label: "4: 15-60s" },
	{ belowMs: 300_000, label: "5: 1-5m" },
];

export function resolveDurationBucket(durationMs: number): string {
	// A non-finite or negative span can only come from a clock adjustment mid-run;
	// treat it as the fastest bucket rather than letting it fall through to ">5m".
	if (!Number.isFinite(durationMs) || durationMs < 0) {
		return DURATION_BUCKET_FASTEST;
	}
	for (const bucket of DURATION_BUCKETS) {
		if (durationMs < bucket.belowMs) {
			return bucket.label;
		}
	}
	return DURATION_BUCKET_OVERFLOW;
}

/**
 * Sent in place of the caller's address so Amplitude cannot reverse-lookup a
 * location from it.
 *
 * Amplitude geo-resolves the request IP when the field is absent. An IP is
 * personal data, none of the metrics need geography, and CI runs — which report
 * without anyone being asked — can originate from a self-hosted runner on a
 * company or home network.
 */
const SUPPRESSED_IP = "0.0.0.0";

/**
 * Canonical command path, e.g. `theme push`.
 *
 * Built by walking the Commander parent chain rather than reading
 * `command.name()`: the deprecated `theme installation <verb>` aliases bind the
 * same command classes as `theme <verb>`, so `name()` returns `"list"` for both
 * and would merge two distinct usage paths into one bucket. Walking the chain also
 * reveals who is still on the deprecated path.
 *
 * The root program name is dropped because it varies with the invoked bin
 * (`tiendanube` or `nuvemshop`), which would otherwise split every metric in two.
 */
export function resolveCommandPath(command: Command | undefined): string {
	if (command === undefined) {
		return "unknown";
	}

	const names: string[] = [];
	let current: Command | undefined = command;
	while (current !== undefined) {
		const parent: Command | undefined = current.parent ?? undefined;
		// A missing parent means this is the root program: skip its name.
		if (parent !== undefined) {
			names.unshift(current.name());
		}
		current = parent;
	}

	return names.length > 0 ? names.join(" ") : "unknown";
}

/**
 * Reduces a thrown value to the smallest set of facts that identifies a failure
 * class.
 *
 * Messages are deliberately excluded: `ThemeApiError.message` interpolates text
 * straight from the API response, and `CliError` messages embed file paths, theme
 * ids and directory listings. None of that may leave the machine, so only the
 * error class and its stable codes are kept.
 *
 * Read structurally instead of with `instanceof` so this module stays independent
 * of the command categories it measures. `code` covers both `ThemeApiError` codes
 * and Node's system errors (ENOTFOUND, EACCES, …), which are the most useful
 * dimension for "why do commands fail".
 */
export function describeError(error: unknown): TelemetryErrorFacts {
	if (!(error instanceof Error)) {
		return { errorType: "UnexpectedError" };
	}

	const record = error as unknown as Record<string, unknown>;
	const code = typeof record.code === "string" ? record.code : undefined;
	const status = typeof record.status === "number" ? record.status : undefined;

	return {
		errorType: error.name.length > 0 ? error.name : "UnexpectedError",
		...(code !== undefined ? { errorCode: code } : {}),
		...(status !== undefined ? { httpStatus: status } : {}),
	};
}

export function buildCommandEvent(params: {
	installId: string;
	command: string;
	status: TelemetryCommandStatus;
	durationMs: number;
	isCi: boolean;
	identity: TelemetryIdentityKind;
	error?: TelemetryErrorFacts;
	now: number;
}): AmplitudeEvent {
	const { installId, command, status, durationMs, isCi, identity, error, now } =
		params;

	return {
		event_type: TELEMETRY_COMMAND_EVENT,
		// No user_id: the CLI has no account identity and deliberately collects none.
		device_id: installId,
		time: now,
		// Reserved Amplitude fields, so built-in version and OS filters work natively.
		app_version: packageJson.version,
		os_name: process.platform,
		// Kernel release, which is what Node exposes cheaply: Darwin 24.x rather than
		// macOS 15.x. Enough to correlate a failure with an OS generation, and it
		// avoids shelling out to `sw_vers` on every command.
		os_version: os.release(),
		platform: "cli",
		ip: SUPPRESSED_IP,
		event_properties: {
			command,
			status,
			duration_ms: durationMs,
			duration_bucket: resolveDurationBucket(durationMs),
			is_ci: isCi,
			// Whether `device_id` represents a returning person or a one-off run.
			// User-based charts must filter to "persistent".
			identity,
			node_version: process.versions.node,
			arch: process.arch,
			...(error !== undefined
				? {
						error_type: error.errorType,
						...(error.errorCode !== undefined
							? { error_code: error.errorCode }
							: {}),
						...(error.httpStatus !== undefined
							? { http_status: error.httpStatus }
							: {}),
					}
				: {}),
		},
	};
}
