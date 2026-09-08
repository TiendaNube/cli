import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./telemetry-client";
import type { AmplitudeEvent } from "./telemetry-event";

const event: AmplitudeEvent = {
	event_type: "cli_command_executed",
	device_id: "11111111-2222-4333-8444-555555555555",
	time: 1_700_000_000_000,
	app_version: "2.1.0",
	os_name: "darwin",
	os_version: "24.6.0",
	platform: "cli",
	ip: "0.0.0.0",
	event_properties: { command: "theme push", status: "success" },
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("TelemetryClient", () => {
	it("posts the api key and events to the configured endpoint", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		await new TelemetryClient("test-key", "https://example.test/collect").Send([
			event,
		]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(url).toBe("https://example.test/collect");
		expect(init?.method).toBe("POST");
		// A followed 307/308 would replay the api key and payload to another origin.
		expect(init?.redirect).toBe("error");
		expect(JSON.parse(String(init?.body))).toEqual({
			api_key: "test-key",
			events: [event],
		});
	});

	it("sends nothing when no api key is configured", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await new TelemetryClient("").Send([event]);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("sends nothing for an empty batch", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await new TelemetryClient("test-key").Send([]);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("swallows network failures so a command is never affected", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("getaddrinfo ENOTFOUND api2.amplitude.com"),
		);

		await expect(
			new TelemetryClient("test-key").Send([event]),
		).resolves.toBeUndefined();
	});

	it("swallows a non-2xx response without retrying", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("nope", { status: 500 }));

		await expect(
			new TelemetryClient("test-key").Send([event]),
		).resolves.toBeUndefined();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("aborts a hanging request rather than delaying exit indefinitely", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			});
		});

		await expect(
			new TelemetryClient("test-key", "https://example.test/collect", 5).Send([
				event,
			]),
		).resolves.toBeUndefined();
	});
});
