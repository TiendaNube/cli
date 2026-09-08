import { describe, expect, it } from "vitest";
import {
	AMPLITUDE_API_KEY_ENV_VAR,
	AMPLITUDE_HTTP_V2_ENDPOINT,
	isContinuousIntegration,
	isTelemetryDisabledByEnvironment,
	isTestEnvironment,
	resolveAmplitudeApiKey,
	resolveTelemetryEnabledOverride,
} from "./telemetry-settings";

describe("AMPLITUDE_HTTP_V2_ENDPOINT", () => {
	it("targets the US data region", () => {
		expect(AMPLITUDE_HTTP_V2_ENDPOINT).toBe(
			"https://api2.amplitude.com/2/httpapi",
		);
	});
});

describe("resolveAmplitudeApiKey", () => {
	it("is empty when nothing is configured, leaving telemetry inert", () => {
		// The normal state for local builds, public-repo clones and this test suite:
		// the build-time identifier is never substituted outside a tsup build.
		expect(resolveAmplitudeApiKey({})).toBe("");
	});

	it("reads the runtime env var so the pipeline can be exercised without a rebuild", () => {
		expect(
			resolveAmplitudeApiKey({ [AMPLITUDE_API_KEY_ENV_VAR]: "runtime-key" }),
		).toBe("runtime-key");
	});

	it("trims surrounding whitespace", () => {
		expect(
			resolveAmplitudeApiKey({ [AMPLITUDE_API_KEY_ENV_VAR]: "  key  " }),
		).toBe("key");
	});

	it("treats a blank env var as unconfigured", () => {
		expect(resolveAmplitudeApiKey({ [AMPLITUDE_API_KEY_ENV_VAR]: "   " })).toBe(
			"",
		);
	});
});

describe("resolveTelemetryEnabledOverride", () => {
	it("is undefined when unset, leaving the other signals to decide", () => {
		expect(resolveTelemetryEnabledOverride({})).toBeUndefined();
	});

	it("treats a blank value as unset, matching shell and CI config conventions", () => {
		expect(
			resolveTelemetryEnabledOverride({
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "",
			}),
		).toBeUndefined();
		expect(
			resolveTelemetryEnabledOverride({
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "   ",
			}),
		).toBeUndefined();
	});

	it.each([
		["TIENDANUBE_CLI_TELEMETRY_ENABLED"],
		["NUVEMSHOP_CLI_TELEMETRY_ENABLED"],
	])("reads both bin-name prefixes: %s", (variable) => {
		expect(resolveTelemetryEnabledOverride({ [variable]: "1" })).toBe(true);
		expect(resolveTelemetryEnabledOverride({ [variable]: "0" })).toBe(false);
		expect(resolveTelemetryEnabledOverride({ [variable]: "false" })).toBe(
			false,
		);
	});

	it("resolves a conflicting pair to off, so the safer intent wins", () => {
		expect(
			resolveTelemetryEnabledOverride({
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "1",
				NUVEMSHOP_CLI_TELEMETRY_ENABLED: "0",
			}),
		).toBe(false);
	});

	it("stays on when both prefixes agree", () => {
		expect(
			resolveTelemetryEnabledOverride({
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "1",
				NUVEMSHOP_CLI_TELEMETRY_ENABLED: "true",
			}),
		).toBe(true);
	});
});

describe("isTelemetryDisabledByEnvironment", () => {
	it("honors the DO_NOT_TRACK convention", () => {
		expect(isTelemetryDisabledByEnvironment({ DO_NOT_TRACK: "1" })).toBe(true);
	});

	it.each([
		["TIENDANUBE_CLI_TELEMETRY_DISABLED"],
		["NUVEMSHOP_CLI_TELEMETRY_DISABLED"],
	])("honors the CLI-specific alias under either prefix: %s", (variable) => {
		expect(isTelemetryDisabledByEnvironment({ [variable]: "true" })).toBe(true);
	});

	it("ignores falsy values so an unset-looking variable does not opt out", () => {
		expect(isTelemetryDisabledByEnvironment({ DO_NOT_TRACK: "0" })).toBe(false);
		expect(isTelemetryDisabledByEnvironment({ DO_NOT_TRACK: "" })).toBe(false);
		expect(isTelemetryDisabledByEnvironment({})).toBe(false);
	});
});

describe("isTestEnvironment", () => {
	it("detects vitest and NODE_ENV=test", () => {
		expect(isTestEnvironment({ VITEST: "true" })).toBe(true);
		expect(isTestEnvironment({ NODE_ENV: "test" })).toBe(true);
		expect(isTestEnvironment({})).toBe(false);
	});
});

describe("isContinuousIntegration", () => {
	it("reads CI the same way the interactivity helpers do", () => {
		expect(isContinuousIntegration({ CI: "true" })).toBe(true);
		expect(isContinuousIntegration({ CI: "" })).toBe(false);
		expect(isContinuousIntegration({})).toBe(false);
	});
});
