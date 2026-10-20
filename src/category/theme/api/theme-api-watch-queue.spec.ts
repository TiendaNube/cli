import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiError } from "./theme-api-error";
import {
	ThemeApiWatchQueue,
	type ThemeWatchChange,
} from "./theme-api-watch-queue";

const DEBOUNCE_MS = 300;

function apiError(status: number): ThemeApiError {
	return new ThemeApiError({
		operation: "Batch update files",
		status,
		code: null,
		apiMessage: "boom",
		body: null,
	});
}

describe("ThemeApiWatchQueue", () => {
	let sentBatches: Map<string, ThemeWatchChange>[];
	let sendBatch: ReturnType<typeof vi.fn>;
	let onBatchError: ReturnType<typeof vi.fn>;
	let queue: ThemeApiWatchQueue;

	beforeEach(() => {
		vi.useFakeTimers();
		sentBatches = [];
		sendBatch = vi.fn(async (batch: ReadonlyMap<string, ThemeWatchChange>) => {
			sentBatches.push(new Map(batch));
		});
		onBatchError = vi.fn();
		queue = new ThemeApiWatchQueue({
			debounceMs: DEBOUNCE_MS,
			sendBatch,
			onBatchError,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("sends a burst of events as one batch once events stop", async () => {
		for (let i = 0; i < 300; i++) {
			queue.enqueue(`sections/s${i}.twig`, "delete");
		}
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
		expect(sendBatch).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(sendBatch).toHaveBeenCalledTimes(1);
		expect(sentBatches[0]?.size).toBe(300);
	});

	it("keeps only the last event per path", async () => {
		queue.enqueue("snippets/a.twig", "upsert");
		queue.enqueue("snippets/a.twig", "delete");
		queue.enqueue("snippets/b.twig", "delete");
		queue.enqueue("snippets/b.twig", "upsert");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

		expect(sentBatches[0]).toEqual(
			new Map([
				["snippets/a.twig", "delete"],
				["snippets/b.twig", "upsert"],
			]),
		);
	});

	it("never has two batches in flight; events during a send go in the next batch", async () => {
		let releaseFirstSend: () => void = () => {};
		let inFlightCount = 0;
		let maxInFlightCount = 0;
		sendBatch.mockImplementation(
			async (batch: ReadonlyMap<string, ThemeWatchChange>) => {
				inFlightCount += 1;
				maxInFlightCount = Math.max(maxInFlightCount, inFlightCount);
				sentBatches.push(new Map(batch));
				if (sentBatches.length === 1) {
					await new Promise<void>((resolve) => {
						releaseFirstSend = resolve;
					});
				}
				inFlightCount -= 1;
			},
		);

		queue.enqueue("snippets/a.twig", "upsert");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		queue.enqueue("snippets/b.twig", "upsert");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
		expect(sendBatch).toHaveBeenCalledTimes(1);

		releaseFirstSend();
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(sendBatch).toHaveBeenCalledTimes(2);
		expect([...(sentBatches[1]?.keys() ?? [])]).toEqual(["snippets/b.twig"]);
		expect(maxInFlightCount).toBe(1);
	});

	it.each([409, 500, 503])(
		"retries a batch once after HTTP %i, then gives up",
		async (status) => {
			sendBatch.mockRejectedValue(apiError(status));
			queue.enqueue("snippets/a.twig", "upsert");

			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(onBatchError).toHaveBeenLastCalledWith(expect.anything(), 1);

			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(sendBatch).toHaveBeenCalledTimes(2);
			expect(onBatchError).toHaveBeenLastCalledWith(expect.anything(), 0);

			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
			expect(sendBatch).toHaveBeenCalledTimes(2);
		},
	);

	it("does not retry a batch the API rejected with another 4xx", async () => {
		sendBatch.mockRejectedValue(apiError(422));
		queue.enqueue("templates/pages/home.json", "delete");

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
		expect(sendBatch).toHaveBeenCalledTimes(1);
		expect(onBatchError).toHaveBeenCalledWith(expect.anything(), 0);
	});

	it("does not overwrite a newer event with the retried one", async () => {
		let rejectFirstSend: (err: unknown) => void = () => {};
		sendBatch.mockImplementationOnce(
			() =>
				new Promise<void>((_, reject) => {
					rejectFirstSend = reject;
				}),
		);

		queue.enqueue("snippets/a.twig", "upsert");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		queue.enqueue("snippets/a.twig", "delete");
		rejectFirstSend(apiError(409));
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

		expect(sentBatches.at(-1)).toEqual(
			new Map([["snippets/a.twig", "delete"]]),
		);
	});
});
