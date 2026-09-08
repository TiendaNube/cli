import os from "node:os";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import {
	TELEMETRY_COMMAND_EVENT,
	buildCommandEvent,
	describeError,
	resolveCommandPath,
	resolveDurationBucket,
} from "./telemetry-event";

/** Mirrors how the real CLI nests commands: program → theme → verb. */
function buildProgram(): Command {
	const program = new Command().name("tiendanube");
	const theme = program.command("theme");
	theme.command("push");
	const installation = theme.command("installation");
	installation.command("list");
	theme.command("list");
	return program;
}

function findCommand(root: Command, pathSegments: string[]): Command {
	let current = root;
	for (const segment of pathSegments) {
		const next = current.commands.find((c) => c.name() === segment);
		if (next === undefined) {
			throw new Error(`missing test command: ${segment}`);
		}
		current = next;
	}
	return current;
}

describe("resolveCommandPath", () => {
	it("joins the parent chain and drops the root program name", () => {
		const program = buildProgram();
		expect(resolveCommandPath(findCommand(program, ["theme", "push"]))).toBe(
			"theme push",
		);
	});

	it("keeps the deprecated installation alias distinct from the direct verb", () => {
		// Both bind the same command class, so `command.name()` alone would return
		// "list" for each and silently merge two different usage paths.
		const program = buildProgram();
		expect(
			resolveCommandPath(
				findCommand(program, ["theme", "installation", "list"]),
			),
		).toBe("theme installation list");
		expect(resolveCommandPath(findCommand(program, ["theme", "list"]))).toBe(
			"theme list",
		);
	});

	it("does not include the bin name, which varies between tiendanube and nuvemshop", () => {
		const program = new Command().name("nuvemshop");
		const theme = program.command("theme");
		const push = theme.command("push");

		expect(resolveCommandPath(push)).toBe("theme push");
	});

	it("falls back to a placeholder for the root command and for no command", () => {
		expect(resolveCommandPath(new Command().name("tiendanube"))).toBe(
			"unknown",
		);
		expect(resolveCommandPath(undefined)).toBe("unknown");
	});
});

describe("describeError", () => {
	it("keeps the error class name", () => {
		const error = new Error("boom");
		error.name = "CliError";
		expect(describeError(error)).toEqual({ errorType: "CliError" });
	});

	it("captures the stable code and HTTP status of an API error", () => {
		const error = Object.assign(
			new Error("theme push failed (HTTP 409): /some/path.tpl conflict"),
			{ name: "ThemeApiError", code: "THEME_NOT_SECTIONABLE", status: 409 },
		);

		expect(describeError(error)).toEqual({
			errorType: "ThemeApiError",
			errorCode: "THEME_NOT_SECTIONABLE",
			httpStatus: 409,
		});
	});

	it("captures Node system error codes", () => {
		const error = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
			code: "ENOTFOUND",
		});

		expect(describeError(error).errorCode).toBe("ENOTFOUND");
	});

	it("never returns the error message", () => {
		const error = Object.assign(
			new Error("push failed for /Users/dev/theme/secret.tpl"),
			{ name: "ThemeApiError", code: "BAD_REQUEST", status: 400 },
		);

		expect(JSON.stringify(describeError(error))).not.toContain("secret.tpl");
		expect(JSON.stringify(describeError(error))).not.toContain("/Users/dev");
	});

	it("labels non-Error throws", () => {
		expect(describeError("a string")).toEqual({
			errorType: "UnexpectedError",
		});
		expect(describeError(undefined)).toEqual({
			errorType: "UnexpectedError",
		});
	});

	it("labels an Error with a blank name", () => {
		const error = new Error("boom");
		error.name = "";
		expect(describeError(error).errorType).toBe("UnexpectedError");
	});
});

describe("resolveDurationBucket", () => {
	it.each([
		[0, "1: <1s"],
		[999, "1: <1s"],
		[1_000, "2: 1-5s"],
		[4_999, "2: 1-5s"],
		[5_000, "3: 5-15s"],
		[14_999, "3: 5-15s"],
		[15_000, "4: 15-60s"],
		[59_999, "4: 15-60s"],
		[60_000, "5: 1-5m"],
		[299_999, "5: 1-5m"],
		[300_000, "6: >5m"],
		// A `theme watch` session, which is why the range runs this far.
		[4 * 60 * 60 * 1_000, "6: >5m"],
	])("buckets %ims as %s", (durationMs, expected) => {
		expect(resolveDurationBucket(durationMs)).toBe(expected);
	});

	it("labels buckets so they sort into chronological order", () => {
		// Amplitude sorts group-by values lexicographically; unprefixed labels
		// would put "1-5m" before "5-15s".
		const labels = [0, 1_000, 5_000, 15_000, 60_000, 300_000].map(
			resolveDurationBucket,
		);
		expect([...labels].sort()).toEqual(labels);
	});

	it("treats a clock adjustment as the fastest bucket, not the slowest", () => {
		expect(resolveDurationBucket(-5_000)).toBe("1: <1s");
		expect(resolveDurationBucket(Number.NaN)).toBe("1: <1s");
	});
});

describe("buildCommandEvent", () => {
	const base = {
		installId: "11111111-2222-4333-8444-555555555555",
		command: "theme push",
		durationMs: 1234,
		isCi: false,
		identity: "persistent" as const,
		now: 1_700_000_000_000,
	};

	it("emits one event type with the command as a property", () => {
		const event = buildCommandEvent({ ...base, status: "success" });

		// A single event type is what keeps "most used commands" a single group-by
		// chart that picks up new commands without any Amplitude taxonomy work.
		expect(event.event_type).toBe(TELEMETRY_COMMAND_EVENT);
		expect(event.event_properties.command).toBe("theme push");
	});

	it("identifies the run only by the anonymous device id", () => {
		const event = buildCommandEvent({ ...base, status: "success" });

		expect(event.device_id).toBe(base.installId);
		expect(event).not.toHaveProperty("user_id");
		expect(JSON.stringify(event)).not.toContain("store");
	});

	it("sets the reserved version and OS fields", () => {
		const event = buildCommandEvent({ ...base, status: "success" });

		expect(event.app_version).toBe(packageJson.version);
		expect(event.os_name).toBe(process.platform);
		expect(event.os_version).toBe(os.release());
		expect(event.time).toBe(base.now);
	});

	it("carries a duration bucket alongside the raw duration", () => {
		// Insurance against Amplitude plans without percentile aggregation on a
		// custom numeric property.
		const event = buildCommandEvent({
			...base,
			status: "success",
			durationMs: 2_500,
		});

		expect(event.event_properties.duration_ms).toBe(2_500);
		expect(event.event_properties.duration_bucket).toBe("2: 1-5s");
	});

	it("omits error properties on success", () => {
		const event = buildCommandEvent({ ...base, status: "success" });

		expect(event.event_properties.status).toBe("success");
		expect(event.event_properties).not.toHaveProperty("error_type");
	});

	it("includes error facts on failure", () => {
		const event = buildCommandEvent({
			...base,
			status: "error",
			error: {
				errorType: "ThemeApiError",
				errorCode: "FILE_LIMIT_EXCEEDED",
				httpStatus: 422,
			},
		});

		expect(event.event_properties).toMatchObject({
			status: "error",
			error_type: "ThemeApiError",
			error_code: "FILE_LIMIT_EXCEEDED",
			http_status: 422,
		});
	});

	it("distinguishes a cancelled run from a failed one", () => {
		// Folding Ctrl-C into errors would permanently inflate the failure rate.
		const event = buildCommandEvent({
			...base,
			status: "cancelled",
			error: { errorType: "CancelError" },
		});

		expect(event.event_properties.status).toBe("cancelled");
	});

	it("tags CI runs so they can be filtered out of the DAU chart", () => {
		const event = buildCommandEvent({ ...base, status: "success", isCi: true });

		expect(event.event_properties.is_ci).toBe(true);
	});

	it("marks whether the identity is a returning person or a one-off run", () => {
		// Stricter than is_ci: an explicit env-var opt-in is also ephemeral, so
		// user-based charts filter on this rather than on is_ci.
		expect(
			buildCommandEvent({ ...base, status: "success" }).event_properties
				.identity,
		).toBe("persistent");
		expect(
			buildCommandEvent({ ...base, status: "success", identity: "ephemeral" })
				.event_properties.identity,
		).toBe("ephemeral");
	});

	it("suppresses the IP so Amplitude cannot geo-resolve the caller", () => {
		// An IP is personal data, no metric needs geography, and CI runs report
		// without anyone being asked.
		expect(buildCommandEvent({ ...base, status: "success" }).ip).toBe(
			"0.0.0.0",
		);
	});
});
