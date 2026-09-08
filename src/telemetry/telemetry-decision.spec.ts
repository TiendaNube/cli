import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryConfigManager } from "./telemetry-config";
import {
	resolveTelemetryDecision,
	resolveTelemetryState,
} from "./telemetry-decision";

const UUID = /^[0-9a-f-]{36}$/;

let workingDir: string;
let manager: TelemetryConfigManager;
let output: string[];

beforeEach(() => {
	workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cli-telemetry-"));
	manager = new TelemetryConfigManager(path.join(workingDir, "config.json"));
	output = [];
	for (const stream of [process.stderr, process.stdout]) {
		vi.spyOn(stream, "write").mockImplementation((chunk) => {
			output.push(String(chunk));
			return true;
		});
	}
	// The cases that omit `env` fall through to the real environment, so every
	// signal that could flip the resolution has to be neutralised.
	for (const variable of [
		"CI",
		"DO_NOT_TRACK",
		"TIENDANUBE_CLI_TELEMETRY_DISABLED",
		"NUVEMSHOP_CLI_TELEMETRY_DISABLED",
		"TIENDANUBE_CLI_TELEMETRY_ENABLED",
		"NUVEMSHOP_CLI_TELEMETRY_ENABLED",
	]) {
		vi.stubEnv(variable, "");
	}
});

afterEach(() => {
	fs.rmSync(workingDir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("resolveTelemetryDecision", () => {
	it("reports by default, minting and storing an anonymous id", () => {
		const decision = resolveTelemetryDecision({ configManager: manager });

		expect(decision.enabled).toBe(true);
		expect(decision.identity).toBe("persistent");
		expect(decision.installId).toMatch(UUID);
		expect(manager.Load()).toEqual({
			telemetryEnabled: true,
			installId: decision.installId,
		});
	});

	it("never says anything on the way past", () => {
		// No first-run notice and no prompt: several commands emit JSON on stdout for
		// `| jq`, and a run that is not interactive must not be interrupted either.
		resolveTelemetryDecision({ configManager: manager });

		expect(output).toEqual([]);
	});

	it("keeps the same identity across runs", () => {
		const first = resolveTelemetryDecision({ configManager: manager });
		const second = resolveTelemetryDecision({ configManager: manager });

		expect(second.installId).toBe(first.installId);
	});

	it("honors a stored opt-out", () => {
		manager.Save({ telemetryEnabled: false });

		expect(resolveTelemetryDecision({ configManager: manager }).enabled).toBe(
			false,
		);
	});

	it.each([
		["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }],
		[
			"TIENDANUBE_CLI_TELEMETRY_DISABLED",
			{ TIENDANUBE_CLI_TELEMETRY_DISABLED: "1" },
		],
		[
			"NUVEMSHOP_CLI_TELEMETRY_DISABLED",
			{ NUVEMSHOP_CLI_TELEMETRY_DISABLED: "1" },
		],
	])("stays off when %s is set, without persisting anything", (_name, env) => {
		const decision = resolveTelemetryDecision({ configManager: manager, env });

		expect(decision.enabled).toBe(false);
		// Not persisted: unsetting the variable must restore the real choice.
		expect(manager.Load()).toBeNull();
	});

	it.each([
		["TIENDANUBE_CLI_TELEMETRY_ENABLED"],
		["NUVEMSHOP_CLI_TELEMETRY_ENABLED"],
	])(
		"lets %s=0 switch reporting off without touching the stored choice",
		(variable) => {
			manager.Save({
				telemetryEnabled: true,
				installId: "11111111-2222-4333-8444-555555555555",
			});

			const decision = resolveTelemetryDecision({
				configManager: manager,
				env: { [variable]: "0" },
			});

			expect(decision.enabled).toBe(false);
			expect(manager.Load()?.telemetryEnabled).toBe(true);
		},
	);

	it("lets an explicit opt-in outrank DO_NOT_TRACK, with a throwaway identity", () => {
		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: { DO_NOT_TRACK: "1", TIENDANUBE_CLI_TELEMETRY_ENABLED: "1" },
		});

		expect(decision.enabled).toBe(true);
		expect(decision.identity).toBe("ephemeral");
		// An env var is a property of an environment, not a decision that outlives it.
		expect(manager.Load()).toBeNull();
	});

	it("lets an explicit opt-in outrank a stored opt-out without rewriting it", () => {
		manager.Save({ telemetryEnabled: false });

		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: { TIENDANUBE_CLI_TELEMETRY_ENABLED: "1" },
		});

		expect(decision.enabled).toBe(true);
		expect(decision.identity).toBe("ephemeral");
		expect(manager.Load()).toEqual({ telemetryEnabled: false });
	});

	it("resolves conflicting override prefixes to off", () => {
		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: {
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "1",
				NUVEMSHOP_CLI_TELEMETRY_ENABLED: "0",
			},
		});

		expect(decision.enabled).toBe(false);
	});

	it("reports from CI with a per-run id and writes no config file", () => {
		// A container cannot keep an identity, which is exactly why user-based charts
		// must exclude it.
		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: { CI: "true" },
		});

		expect(decision.enabled).toBe(true);
		expect(decision.identity).toBe("ephemeral");
		expect(decision.installId).toMatch(UUID);
		expect(manager.Load()).toBeNull();
	});

	it("mints a fresh identity on every CI run", () => {
		const first = resolveTelemetryDecision({
			configManager: manager,
			env: { CI: "true" },
		});
		const second = resolveTelemetryDecision({
			configManager: manager,
			env: { CI: "true" },
		});

		expect(first.installId).not.toBe(second.installId);
	});

	it("lets a stored opt-out beat the CI default", () => {
		// A self-hosted runner where someone explicitly said no stays declined.
		manager.Save({ telemetryEnabled: false });

		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: { CI: "true" },
		});

		expect(decision.enabled).toBe(false);
	});

	it("reuses a stored identity in CI rather than minting a per-run one", () => {
		manager.Save({
			telemetryEnabled: true,
			installId: "11111111-2222-4333-8444-555555555555",
		});

		const decision = resolveTelemetryDecision({
			configManager: manager,
			env: { CI: "true" },
		});

		expect(decision).toEqual({
			enabled: true,
			installId: "11111111-2222-4333-8444-555555555555",
			identity: "persistent",
		});
	});

	it("falls back to a throwaway identity when the id cannot be stored", () => {
		// An id that cannot be written would differ on every run, turning one
		// developer into a new "daily user" each time. Reporting as ephemeral keeps
		// the run out of every user-based chart instead.
		const blocker = path.join(workingDir, "blocker");
		fs.writeFileSync(blocker, "");
		const unwritable = new TelemetryConfigManager(
			path.join(blocker, "config.json"),
		);

		const decision = resolveTelemetryDecision({ configManager: unwritable });

		expect(decision.enabled).toBe(true);
		expect(decision.identity).toBe("ephemeral");
		expect(decision.installId).toMatch(UUID);
	});
});

describe("resolveTelemetryState", () => {
	it("reports the effective state without creating an identity", () => {
		// `telemetry status` runs this: reading the state must not be what
		// mints the id it reports.
		const resolution = resolveTelemetryState({ stored: null, env: {} });

		expect(resolution).toEqual({
			outcome: "on",
			reason: "collected by default",
			identity: "persistent",
		});
		expect(manager.Load()).toBeNull();
	});

	it("explains why reporting is off", () => {
		expect(
			resolveTelemetryState({
				stored: { telemetryEnabled: false },
				env: {},
			}),
		).toEqual({ outcome: "off", reason: "you opted out on this machine" });
	});

	it.each([
		[
			"the enabled override off",
			{ TIENDANUBE_CLI_TELEMETRY_ENABLED: "0" },
			"TIENDANUBE_CLI_TELEMETRY_ENABLED=0",
		],
		[
			"the enabled override on",
			{
				DO_NOT_TRACK: "1",
				TIENDANUBE_CLI_TELEMETRY_ENABLED: "1",
			},
			"TIENDANUBE_CLI_TELEMETRY_ENABLED=1",
		],
		[
			"the disabled alias",
			{ TIENDANUBE_CLI_TELEMETRY_DISABLED: "1" },
			"TIENDANUBE_CLI_TELEMETRY_DISABLED",
		],
	])(
		"names a variable the CLI actually reads when reporting %s",
		(_name, env, expected) => {
			// `telemetry status` prints these verbatim, so an unprefixed name would
			// send a user off to set a variable that does nothing.
			const { reason } = resolveTelemetryState({ stored: null, env });

			expect(reason).toContain(expected);
		},
	);
});
