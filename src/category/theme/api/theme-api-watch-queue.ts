import { ThemeApiError } from "./theme-api-error";

export type ThemeWatchChange = "upsert" | "delete";

type PendingWatchChange = {
	change: ThemeWatchChange;
	alreadyRetried: boolean;
};

export type ThemeApiWatchQueueOptions = {
	debounceMs: number;
	/** Sends one batch; a throw fails every path in it. */
	sendBatch: (batch: ReadonlyMap<string, ThemeWatchChange>) => Promise<void>;
	onBatchError: (err: unknown, requeuedPathCount: number) => void;
};

/** 409 means another writer holds the installation lock; any other 4xx is a bad batch that a resend won't fix. */
function isRetryableBatchError(err: unknown): boolean {
	if (err instanceof ThemeApiError) {
		return err.status === 409 || err.status >= 500;
	}
	return true;
}

/**
 * Coalesces watch events per path (the last one wins) and sends them as a single
 * batch once events stop for `debounceMs`. Only one batch is in flight at a time,
 * so a folder delete or a branch switch costs one request instead of one per file.
 */
export class ThemeApiWatchQueue {
	private pending = new Map<string, PendingWatchChange>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private batchInFlight = false;

	constructor(private readonly options: ThemeApiWatchQueueOptions) {}

	enqueue(relativePath: string, change: ThemeWatchChange): void {
		this.pending.set(relativePath, { change, alreadyRetried: false });
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.flush();
		}, this.options.debounceMs);
	}

	private async flush(): Promise<void> {
		// Events that arrive while a batch is in flight wait for the next one.
		if (this.batchInFlight || this.pending.size === 0) {
			return;
		}
		const batch = this.pending;
		this.pending = new Map();
		this.batchInFlight = true;
		try {
			await this.sendWithRequeue(batch);
		} finally {
			this.batchInFlight = false;
		}
		if (this.pending.size > 0) {
			this.scheduleFlush();
		}
	}

	private async sendWithRequeue(
		batch: Map<string, PendingWatchChange>,
	): Promise<void> {
		const changes = new Map<string, ThemeWatchChange>();
		for (const [relativePath, pending] of batch) {
			changes.set(relativePath, pending.change);
		}
		try {
			await this.options.sendBatch(changes);
		} catch (err) {
			// Retry each path once, unless a newer event already replaced it.
			let requeuedPathCount = 0;
			if (isRetryableBatchError(err)) {
				for (const [relativePath, pending] of batch) {
					if (!pending.alreadyRetried && !this.pending.has(relativePath)) {
						this.pending.set(relativePath, {
							change: pending.change,
							alreadyRetried: true,
						});
						requeuedPathCount += 1;
					}
				}
			}
			this.options.onBatchError(err, requeuedPathCount);
		}
	}
}
