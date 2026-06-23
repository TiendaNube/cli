import packageJson from "../../../../package.json" with { type: "json" };
import { CliLogger } from "../../../cli-logger";
import {
	THEME_API_BATCH_MAX_BODY_BYTES,
	THEME_API_HTTP_STATUS_SERVICE_UNAVAILABLE,
	THEME_API_HTTP_STATUS_TOO_MANY_REQUESTS,
	THEME_API_MAX_ATTEMPTS_FOR_REQUESTS,
	THEME_API_MAX_PARALLEL,
	THEME_API_REQUEST_TIMEOUT_MS,
	normalizeApiBaseUrl,
} from "./theme-api-constants";
import {
	ThemeApiError,
	extractThemeApiCodeAndMessage,
} from "./theme-api-error";

export type ThemeApiClientOptions = {
	apiBaseUrl: string;
	publicApiToken: string;
	storeId: string;
	verbose?: boolean;
	extraHeaders?: Record<string, string>;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isThemeApiFetchAbortError(err: unknown): boolean {
	if (err instanceof DOMException && err.name === "AbortError") {
		return true;
	}
	return (
		typeof err === "object" &&
		err !== null &&
		"name" in err &&
		(err as { name: unknown }).name === "AbortError"
	);
}

function encodeFilePathForUrl(filePath: string): string {
	const posix = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
	return posix
		.split("/")
		.filter((s) => s.length > 0)
		.map((s) => encodeURIComponent(s))
		.join("/");
}

function isRetryableThemeApiHttpStatus(status: number): boolean {
	return (
		status === THEME_API_HTTP_STATUS_TOO_MANY_REQUESTS ||
		status === THEME_API_HTTP_STATUS_SERVICE_UNAVAILABLE
	);
}

/**
 * Seconds ≥ this are treated as Unix epoch; smaller values are delta-seconds until reset.
 * ~1e9 ≈ 2001-09-09 UTC, so typical 2020s API timestamps use the epoch branch.
 */
const RATE_LIMIT_RESET_UNIX_EPOCH_THRESHOLD_SEC = 1_000_000_000;

function themeApiRequestRetryDelayMs(
	status: number,
	attempt: number,
	headers: Headers,
): number {
	if (status === THEME_API_HTTP_STATUS_TOO_MANY_REQUESTS) {
		const resetHeader = headers.get("x-rate-limit-reset");
		const resetSeconds = resetHeader
			? Number.parseInt(resetHeader.trim(), 10)
			: Number.NaN;
		if (Number.isFinite(resetSeconds) && resetSeconds >= 0) {
			const delayMs =
				resetSeconds >= RATE_LIMIT_RESET_UNIX_EPOCH_THRESHOLD_SEC
					? resetSeconds * 1000 - Date.now()
					: resetSeconds * 1000;
			return Math.min(Math.max(delayMs, 200), 30_000);
		}
	}
	return Math.min(1000 * 2 ** attempt, 30_000);
}

function themeApiRetryLogReason(status: number): string {
	if (status === THEME_API_HTTP_STATUS_TOO_MANY_REQUESTS) {
		return "Rate limited";
	}
	if (status === THEME_API_HTTP_STATUS_SERVICE_UNAVAILABLE) {
		return "Service unavailable";
	}
	return `HTTP ${status}`;
}

export async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(concurrency, items.length);

	async function worker(): Promise<void> {
		for (;;) {
			const i = nextIndex;
			nextIndex += 1;
			if (i >= items.length) {
				break;
			}
			const item = items[i];
			if (!item) {
				continue;
			}
			results[i] = await fn(item, i);
		}
	}

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

export class ThemeApiClient {
	private logger = new CliLogger();
	private apiBaseUrl: string;
	private publicApiToken: string;
	private storeId: string;
	private verbose: boolean;
	private userAgent: string;
	private extraHeaders: Record<string, string>;

	public constructor(options: ThemeApiClientOptions) {
		this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
		this.publicApiToken = options.publicApiToken;
		this.storeId = options.storeId;
		this.verbose = options.verbose ?? false;
		this.extraHeaders = options.extraHeaders ?? {};
		const name = packageJson.name.replace(/^@[^/]+\//, "");
		this.userAgent = `${name}/${packageJson.version} (https://github.com/TiendaNube/nube-cli)`;
	}

	private baseHeaders(): Record<string, string> {
		return {
			Authentication: `bearer ${this.publicApiToken}`,
			"User-Agent": this.userAgent,
		};
	}

	/** Order: base → extra (--header) → per-call init.headers; later .set() wins case-insensitively. */
	private buildRequestHeaders(initHeaders: HeadersInit | undefined): Headers {
		const merged = new Headers();
		for (const [k, v] of Object.entries(this.baseHeaders())) {
			merged.set(k, v);
		}
		for (const [k, v] of Object.entries(this.extraHeaders)) {
			merged.set(k, v);
		}
		if (initHeaders) {
			const callHeaders = new Headers(initHeaders);
			callHeaders.forEach((v, k) => {
				merged.set(k, v);
			});
		}
		return merged;
	}

	private installationsBase(): string {
		return `${this.apiBaseUrl}/v1/${this.storeId}/theme-installations`;
	}

	private installationUrl(installationId: string): string {
		return `${this.installationsBase()}/${installationId}`;
	}

	private log(msg: string): void {
		if (this.verbose) {
			this.logger.Log(msg);
		}
	}

	private async request(
		url: string,
		init: RequestInit,
	): Promise<{
		ok: boolean;
		status: number;
		body: unknown;
		text: string;
		contentType: string | null;
	}> {
		let attempt = 0;
		let lastText = "";

		for (;;) {
			const { signal: userSignal, ...initWithoutSignal } = init;
			const controller = new AbortController();

			if (userSignal?.aborted) {
				throw new DOMException("The operation was aborted.", "AbortError");
			}

			const onUserAbort = (): void => {
				controller.abort(userSignal?.reason);
			};
			if (userSignal) {
				userSignal.addEventListener("abort", onUserAbort, { once: true });
			}

			const timeoutMs = THEME_API_REQUEST_TIMEOUT_MS;
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, timeoutMs);

			let res: Response;
			try {
				res = await fetch(url, {
					...initWithoutSignal,
					signal: controller.signal,
					headers: this.buildRequestHeaders(initWithoutSignal.headers),
				});
			} catch (err) {
				const userAborted = Boolean(userSignal?.aborted);
				const hasAttemptsLeft =
					attempt < THEME_API_MAX_ATTEMPTS_FOR_REQUESTS - 1;
				if (!userAborted && hasAttemptsLeft && isThemeApiFetchAbortError(err)) {
					const waitMs = themeApiRequestRetryDelayMs(
						THEME_API_HTTP_STATUS_SERVICE_UNAVAILABLE,
						attempt,
						new Headers(),
					);
					this.log(
						`Request aborted after ${timeoutMs}ms (fetch timeout), waiting ${waitMs}ms before retry`,
					);
					await sleep(waitMs);
					attempt += 1;
					continue;
				}
				throw err;
			} finally {
				clearTimeout(timeoutId);
				if (userSignal) {
					userSignal.removeEventListener("abort", onUserAbort);
				}
			}

			lastText = await res.text();
			let body: unknown = lastText;
			if (lastText.length > 0) {
				try {
					body = JSON.parse(lastText) as unknown;
				} catch {
					// keep as string
				}
			}

			const hasAttemptsLeft = attempt < THEME_API_MAX_ATTEMPTS_FOR_REQUESTS - 1;
			if (hasAttemptsLeft && isRetryableThemeApiHttpStatus(res.status)) {
				const waitMs = themeApiRequestRetryDelayMs(
					res.status,
					attempt,
					res.headers,
				);
				this.log(
					`${themeApiRetryLogReason(res.status)} (${res.status}), waiting ${waitMs}ms before retry`,
				);
				await sleep(waitMs);
				attempt += 1;
				continue;
			}

			return {
				ok: res.ok,
				status: res.status,
				body,
				text: lastText,
				contentType: res.headers.get("content-type"),
			};
		}
	}

	/** Wraps `request()`: returns parsed body on success, throws `ThemeApiError` on failure. */
	private async requestJson<T>(
		operation: string,
		url: string,
		init: RequestInit,
	): Promise<T> {
		const { ok, status, body, text, contentType } = await this.request(
			url,
			init,
		);
		if (!ok) {
			const { code, message } = extractThemeApiCodeAndMessage(
				body,
				text,
				contentType,
			);
			throw new ThemeApiError({
				operation,
				status,
				code,
				apiMessage: message,
				body,
			});
		}
		return body as T;
	}

	async listInstallations(): Promise<unknown> {
		const url = this.installationsBase();
		this.log(`GET ${url}`);
		return this.requestJson("List installations", url, { method: "GET" });
	}

	async createInstallation(payload: {
		theme_code: string;
		title: string;
		theme_variant?: string;
	}): Promise<unknown> {
		const url = this.installationsBase();
		this.log(`POST ${url}`);
		return this.requestJson("Create installation", url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	}

	async getInstallation(installationId: string): Promise<unknown> {
		const url = this.installationUrl(installationId);
		this.log(`GET ${url}`);
		return this.requestJson("Get installation", url, { method: "GET" });
	}

	/** DELETE …/theme-installations/{id} — removes the installation (irreversible). */
	async deleteInstallation(installationId: string): Promise<unknown> {
		const url = this.installationUrl(installationId);
		this.log(`DELETE ${url}`);
		return this.requestJson("Delete installation", url, { method: "DELETE" });
	}

	/** POST …/publish — marks the installation as productive (live for the storefront). */
	async publishInstallation(installationId: string): Promise<unknown> {
		const url = `${this.installationUrl(installationId)}/publish`;
		this.log(`POST ${url}`);
		return this.requestJson("Publish installation", url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
	}

	/** POST …/fork — sets the installation as forked (full theme paths allowed on push). */
	async forkInstallation(installationId: string): Promise<unknown> {
		const url = `${this.installationUrl(installationId)}/fork`;
		this.log(`POST ${url}`);
		return this.requestJson("Fork installation", url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
	}

	/** POST …/clone — creates a new installation identical to the source (typically HTTP 201). */
	async cloneInstallation(installationId: string): Promise<unknown> {
		const url = `${this.installationUrl(installationId)}/clone`;
		this.log(`POST ${url}`);
		return this.requestJson("Clone installation", url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
	}

	async getFileHashes(installationId: string): Promise<unknown> {
		const url = `${this.installationUrl(installationId)}/file-hashes`;
		this.log(`GET ${url}`);
		return this.requestJson("GET file hashes", url, { method: "GET" });
	}

	async getFiles(
		installationId: string,
		options?: { fileTypes?: string[]; offset?: number; limit?: number },
	): Promise<unknown> {
		const parts: string[] = [];
		for (const t of options?.fileTypes ?? []) {
			parts.push(`file-type[]=${encodeURIComponent(t)}`);
		}
		if (options?.offset !== undefined) {
			parts.push(`offset=${options.offset}`);
		}
		if (options?.limit !== undefined) {
			parts.push(`limit=${options.limit}`);
		}
		const qs = parts.join("&");
		const url = `${this.installationUrl(installationId)}/files${qs ? `?${qs}` : ""}`;
		this.log(`GET ${url}`);
		return this.requestJson("GET theme files", url, { method: "GET" });
	}

	async upsertFile(
		installationId: string,
		filePath: string,
		content: unknown,
		format: string,
		revisionToken?: string,
	): Promise<unknown> {
		const encoded = encodeFilePathForUrl(filePath);
		const url = `${this.installationUrl(installationId)}/files/${encoded}`;
		const bodyPayload: Record<string, unknown> = { content, format };
		if (revisionToken) {
			bodyPayload.revision_token = revisionToken;
		}
		this.log(`PUT ${url}`);
		return this.requestJson(`PUT theme file ${filePath}`, url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(bodyPayload),
		});
	}

	async deleteFile(installationId: string, filePath: string): Promise<unknown> {
		const encoded = encodeFilePathForUrl(filePath);
		const url = `${this.installationUrl(installationId)}/files/${encoded}`;
		this.log(`DELETE ${url}`);
		return this.requestJson(`DELETE theme file ${filePath}`, url, {
			method: "DELETE",
		});
	}

	async batchUpdateFiles(
		installationId: string,
		upsert: { path: string; content: unknown; format: string }[],
		toDelete: string[],
	): Promise<void> {
		const url = `${this.installationUrl(installationId)}/files`;

		// Split upsert into size-based chunks to stay under proxy body-size limits.
		const chunks: (typeof upsert)[] = [];
		let current: typeof upsert = [];
		let currentBytes = 0;
		for (const item of upsert) {
			const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
			if (
				current.length > 0 &&
				currentBytes + itemBytes > THEME_API_BATCH_MAX_BODY_BYTES
			) {
				chunks.push(current);
				current = [];
				currentBytes = 0;
			}
			current.push(item);
			currentBytes += itemBytes;
		}
		chunks.push(current);

		for (let i = 0; i < chunks.length; i++) {
			// Deletions are sent only in the first chunk (path strings add negligible size).
			const chunkDelete = i === 0 ? toDelete : [];
			const chunkLabel =
				chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : "";
			this.log(`PATCH ${url}${chunkLabel}`);
			await this.requestJson(`Batch update files${chunkLabel}`, url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ upsert: chunks[i], delete: chunkDelete }),
			});
		}
	}

	getMaxParallel(): number {
		return THEME_API_MAX_PARALLEL;
	}

	async runWithConcurrency<T, R>(
		items: T[],
		fn: (item: T, index: number) => Promise<R>,
	): Promise<R[]> {
		return mapPool(items, THEME_API_MAX_PARALLEL, fn);
	}
}
