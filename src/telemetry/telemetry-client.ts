import type { AmplitudeEvent } from "./telemetry-event";
import { AMPLITUDE_HTTP_V2_ENDPOINT } from "./telemetry-settings";

/**
 * Worst-case delay added to process exit when the network is unreachable. Kept
 * short because it is paid after the command has already printed its output.
 */
export const TELEMETRY_REQUEST_TIMEOUT_MS = 1500;

/**
 * Minimal Amplitude HTTP V2 client.
 *
 * Hand-rolled rather than pulling in `@amplitude/analytics-node`: the payload is
 * one JSON object, `fetch` is built in, and an SDK would add startup cost plus a
 * background queue that has to be forced to drain so it never keeps `theme watch`
 * alive. It also keeps the transport swappable for an internal proxy endpoint
 * later without touching any call site.
 */
export class TelemetryClient {
	public constructor(
		private readonly apiKey: string,
		private readonly endpoint: string = AMPLITUDE_HTTP_V2_ENDPOINT,
		private readonly timeoutMs: number = TELEMETRY_REQUEST_TIMEOUT_MS,
	) {}

	/**
	 * Best-effort delivery: never throws, never retries.
	 *
	 * Intentionally not awaited by callers. Output is already flushed by the time
	 * this runs, and a pending request keeps the event loop alive just long enough
	 * to finish, so an offline or throttled network delays process exit by at most
	 * `timeoutMs` instead of delaying the command itself.
	 */
	async Send(events: AmplitudeEvent[]): Promise<void> {
		if (this.apiKey.length === 0 || events.length === 0) {
			return;
		}

		try {
			await fetch(this.endpoint, {
				method: "POST",
				// A 307/308 preserves the method and body, so following one would
				// replay the api key and the event payload to whatever origin the
				// redirect names. The ingestion endpoint never redirects; if it ever
				// does, dropping the batch through the catch below is the right cost.
				redirect: "error",
				headers: {
					"Content-Type": "application/json",
					Accept: "*/*",
				},
				body: JSON.stringify({ api_key: this.apiKey, events }),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch {
			// Telemetry must never affect a command's output or exit status. A
			// rejected request, a DNS failure or the abort timeout are all no-ops.
			return;
		}
	}
}
