import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryConfigManager } from "../telemetry-config";
import { TelemetryCommands } from "./telemetry-command";

/** Every variable `resolveTelemetryState` consults. */
const TELEMETRY_ENV_VARS = [
	"CI",
	"DO_NOT_TRACK",
	"TIENDANUBE_CLI_TELEMETRY_DISABLED",
	"NUVEMSHOP_CLI_TELEMETRY_DISABLED",
	"TIENDANUBE_CLI_TELEMETRY_ENABLED",
	"NUVEMSHOP_CLI_TELEMETRY_ENABLED",
];

let workingDir: string;
let manager: TelemetryConfigManager;
let logged: string[];
let originalExitCode: typeof process.exitCode;

/** `telemetry …`, bound on a stand-in program with a throwaway config file. */
async function run(...argv: string[]): Promise<void> {
	const program = new Command();
	new TelemetryCommands(manager).Bind(program);
	await program.parseAsync(["telemetry", ...argv], { from: "user" });
}

function loggedText(): string {
	return logged.join("\n");
}

beforeEach(() => {
	originalExitCode = process.exitCode;
	workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cli-telemetry-cmd-"));
	manager = new TelemetryConfigManager(path.join(workingDir, "config.json"));
	logged = [];
	for (const level of ["log", "warn", "error"] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		});
	}
	// `Status` reads the real environment, so every signal that could flip the
	// resolution has to be neutralised or these tests pass or fail with the host.
	for (const variable of TELEMETRY_ENV_VARS) {
		vi.stubEnv(variable, "");
	}
	vi.stubEnv("TIENDANUBE_CLI_AMPLITUDE_API_KEY", "test-key");
});

afterEach(() => {
	process.exitCode = originalExitCode;
	fs.rmSync(workingDir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("telemetry", () => {
	it("binds the three controls directly under the program", () => {
		// The public contract: these are the paths the README documents and what a
		// user types to opt out.
		const program = new Command();
		new TelemetryCommands(manager).Bind(program);
		const telemetry = program.commands.find(
			(command) => command.name() === "telemetry",
		);

		expect(telemetry?.commands.map((command) => command.name()).sort()).toEqual(
			["disable", "enable", "status"],
		);
	});

	it("reports collection as on before anything has been stored", async () => {
		await run("status");

		expect(loggedText()).toContain("Telemetry: on — collected by default");
		// Reading the state must not be what creates the id.
		expect(manager.Load()).toBeNull();
		expect(loggedText()).toContain("telemetry disable");
	});

	it("stores an opt-out and then reports it", async () => {
		await run("disable");
		expect(manager.Load()).toEqual({ telemetryEnabled: false });

		await run("status");
		expect(loggedText()).toContain("Telemetry: off");
		expect(loggedText()).toContain("you opted out on this machine");
	});

	it("opts back in with a fresh identity", async () => {
		// `disable` drops the id, so this pair is also how the id gets rotated.
		await run("disable");
		await run("enable");

		const stored = manager.Load();
		expect(stored?.telemetryEnabled).toBe(true);
		expect(stored?.installId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("keeps the existing identity when enabling an already-enabled install", async () => {
		await run("enable");
		const first = manager.Load()?.installId;
		await run("enable");

		expect(manager.Load()?.installId).toBe(first);
	});

	it.each(["enable", "disable"])(
		"exits non-zero when %s cannot store the preference",
		async (subcommand) => {
			// A script that flips the setting has to be able to tell that the write
			// failed; logging the error and exiting 0 would hide it.
			vi.spyOn(manager, "Save").mockReturnValue(false);

			await run(subcommand);

			expect(process.exitCode).toBe(1);
			expect(loggedText()).toContain("Could not write");
		},
	);

	it("warns that nothing is sent when the build carries no api key", async () => {
		vi.stubEnv("TIENDANUBE_CLI_AMPLITUDE_API_KEY", "");

		await run("status");

		expect(loggedText()).toContain("not configured in this build");
	});
});
