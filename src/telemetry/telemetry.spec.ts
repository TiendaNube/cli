import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryCommands } from "./commands/telemetry-command";
import { CommandTelemetry } from "./telemetry";

vi.mock("./telemetry-decision", () => ({
	resolveTelemetryDecision: vi.fn(() => ({
		enabled: true,
		installId: "11111111-2222-4333-8444-555555555555",
		identity: "persistent",
	})),
}));

/** Mirrors the real nesting so the reported command path is exercised too. */
function themePushCommand(): Command {
	const program = new Command().name("tiendanube");
	const theme = program.command("theme");
	return theme.command("push");
}

/**
 * The real `telemetry disable`, bound the way `cli.ts` binds it, so renaming the
 * group breaks this test instead of silently making the telemetry controls report
 * themselves.
 */
function telemetryDisableCommand(): Command {
	const program = new Command().name("tiendanube");
	new TelemetryCommands().Bind(program);
	const telemetry = program.commands.find(
		(command) => command.name() === "telemetry",
	);
	const disable = telemetry?.commands.find(
		(command) => command.name() === "disable",
	);
	if (disable === undefined) {
		throw new Error("`telemetry disable` is no longer bound");
	}
	return disable;
}

function sentEvent(fetchSpy: { mock: { calls: unknown[][] } }) {
	const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
	return JSON.parse(String(init?.body)).events[0];
}

beforeEach(() => {
	vi.useFakeTimers();
	// Undo the test-environment guard so the real reporting path runs here.
	vi.stubEnv("VITEST", "");
	vi.stubEnv("NODE_ENV", "development");
	vi.stubEnv("CI", "");
	vi.stubEnv("TIENDANUBE_CLI_AMPLITUDE_API_KEY", "test-key");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("CommandTelemetry", () => {
	it("measures the command body and nothing else", () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		const telemetry = new CommandTelemetry();
		telemetry.Begin(themePushCommand());
		vi.advanceTimersByTime(120);
		telemetry.Finish("success");

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(sentEvent(fetchSpy).event_properties.duration_ms).toBe(120);
	});

	it("reports the canonical command path and the granted anonymous id", () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		const telemetry = new CommandTelemetry();
		telemetry.Begin(themePushCommand());
		telemetry.Finish("success");

		const event = sentEvent(fetchSpy);
		expect(event.event_properties.command).toBe("theme push");
		expect(event.device_id).toBe("11111111-2222-4333-8444-555555555555");
	});

	it("sends nothing when there is no api key to send with", () => {
		vi.stubEnv("TIENDANUBE_CLI_AMPLITUDE_API_KEY", "");
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const telemetry = new CommandTelemetry();
		telemetry.Begin(themePushCommand());
		telemetry.Finish("success");

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not report the telemetry controls themselves", () => {
		// `telemetry disable` must not mint an identity on its way out and send an
		// event about it.
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const telemetry = new CommandTelemetry();
		telemetry.Begin(telemetryDisableCommand());
		telemetry.Finish("success");

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
