import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import { resolveUserConfigDir } from "../../../telemetry/telemetry-config-path";
import { isTestEnvironment } from "../../../telemetry/telemetry-settings";
import { withNextSteps } from "../cli/auth-messages";
import { storefrontHost } from "../domain/auth-alias";
import type {
	AuthTokenKind,
	CredentialsDocument,
	Identity,
	StoreData,
	StoreTokens,
} from "../domain/auth-credentials-types";

export const CREDENTIALS_CONFIG_VERSION = 1;
export const CREDENTIALS_FILE_NAME = "credentials.json";

/**
 * Next to `config.json`, never inside it: support tells people to delete that
 * one. Under a test runner it points at a per-process temp directory, so a
 * spec that forgets to inject a path can never read or overwrite the real
 * file of whoever runs the suite.
 */
export function resolveCredentialsPath(): string {
	if (isTestEnvironment()) {
		return path.join(
			os.tmpdir(),
			`tiendanube-cli-test-${process.pid}`,
			CREDENTIALS_FILE_NAME,
		);
	}
	return path.join(resolveUserConfigDir(), CREDENTIALS_FILE_NAME);
}

const LOCK_WAIT_MS = 3000;
const LOCK_RETRY_MS = 25;
/** A lock older than this was left by a crashed run, not held by a live one. */
const LOCK_STALE_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isValidStoreData(value: unknown): value is StoreData {
	return (
		isRecord(value) &&
		isOptionalString(value.storeId) &&
		isOptionalString(value.storeUrl)
	);
}

function isValidStoreTokens(value: unknown): value is StoreTokens {
	if (!isRecord(value)) {
		return false;
	}
	const { api, ftp } = value;
	if (api !== undefined) {
		if (!isRecord(api) || !isNonEmptyString(api.accessToken)) {
			return false;
		}
		if (!isOptionalString(api.apiBaseUrl)) {
			return false;
		}
	}
	if (ftp !== undefined) {
		if (
			!isRecord(ftp) ||
			!isNonEmptyString(ftp.server) ||
			typeof ftp.username !== "string" ||
			typeof ftp.password !== "string"
		) {
			return false;
		}
	}
	return true;
}

/** Per-`type` validation: each kind of identity owns the shape of its `data` and `tokens`. */
function describeInvalidIdentity(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return "entry is not an object";
	}
	if (!isNonEmptyString(value.alias)) {
		return "entry has no alias";
	}
	if (
		!isNonEmptyString(value.createdAt) ||
		!isOptionalString(value.lastUsedAt)
	) {
		return `"${value.alias}" has invalid timestamps`;
	}
	switch (value.type) {
		case "store":
			if (!isValidStoreData(value.data)) {
				return `"${value.alias}" has invalid data`;
			}
			if (!isValidStoreTokens(value.tokens)) {
				return `"${value.alias}" has invalid tokens`;
			}
			return undefined;
		default:
			return `"${value.alias}" has unknown type ${JSON.stringify(value.type)}`;
	}
}

/**
 * The per-user credentials file. Unlike `TelemetryConfigManager`, which treats
 * a corrupt file as absent, every invalid read throws: overwriting an
 * unreadable file here would silently destroy store tokens.
 */
export class AuthCredentialsStore {
	public constructor(
		private readonly filePath: string = resolveCredentialsPath(),
	) {}

	get FilePath(): string {
		return this.filePath;
	}

	private fail(detail: string): never {
		const bin = getCliExecutableName();
		throw new CliError(
			withNextSteps(
				`The file that stores your credentials is damaged and could not be read (${detail}).`,
				`Fix it by hand, or delete ${this.filePath} and sign in again with ${bin} auth login`,
			),
		);
	}

	private read(): CredentialsDocument {
		let raw: string;
		try {
			raw = fs.readFileSync(this.filePath, "utf8");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
				return { configVersion: CREDENTIALS_CONFIG_VERSION, identities: [] };
			}
			const msg = cause instanceof Error ? cause.message : String(cause);
			throw new CliError(
				withNextSteps(
					`Could not open the file that stores your credentials (${msg}).`,
					`Check that your user can read ${this.filePath}`,
				),
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.fail("not valid JSON");
		}
		if (!isRecord(parsed)) {
			this.fail("root value must be a JSON object");
		}
		if (
			typeof parsed.configVersion === "number" &&
			parsed.configVersion > CREDENTIALS_CONFIG_VERSION
		) {
			throw new CliError(
				withNextSteps(
					"Your credentials were saved by a newer version of this CLI, which this version cannot read.",
					"Update the CLI: npm install -g @tiendanube/cli",
				),
			);
		}
		if (parsed.configVersion !== CREDENTIALS_CONFIG_VERSION) {
			this.fail(`configVersion ${JSON.stringify(parsed.configVersion)}`);
		}
		if (!Array.isArray(parsed.identities)) {
			this.fail('"identities" must be a list');
		}

		const seen = new Set<string>();
		for (const entry of parsed.identities) {
			const problem = describeInvalidIdentity(entry);
			if (problem !== undefined) {
				this.fail(problem);
			}
			const alias = (entry as Identity).alias;
			if (seen.has(alias)) {
				this.fail(`alias "${alias}" appears more than once`);
			}
			seen.add(alias);
		}
		if (
			parsed.defaultAlias !== undefined &&
			!isNonEmptyString(parsed.defaultAlias)
		) {
			this.fail('"defaultAlias" must be an alias');
		}
		return {
			configVersion: CREDENTIALS_CONFIG_VERSION,
			identities: parsed.identities as Identity[],
			...(parsed.defaultAlias !== undefined
				? { defaultAlias: parsed.defaultAlias }
				: {}),
		};
	}

	private write({ identities, defaultAlias }: CredentialsDocument): void {
		const aliases = new Set<string>();
		for (const identity of identities) {
			if (aliases.has(identity.alias)) {
				throw new CliError(
					`The alias "${identity.alias}" is already in use; pick another one with --alias.`,
				);
			}
			aliases.add(identity.alias);
		}
		const document: CredentialsDocument = {
			configVersion: CREDENTIALS_CONFIG_VERSION,
			identities,
			...(defaultAlias !== undefined && aliases.has(defaultAlias)
				? { defaultAlias }
				: {}),
		};
		const payload = `${JSON.stringify(document, null, 2)}\n`;
		const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
		try {
			// `mode` is ignored on Windows, where %APPDATA% is already per-user by ACL.
			fs.mkdirSync(path.dirname(this.filePath), {
				recursive: true,
				mode: 0o700,
			});
			fs.writeFileSync(temporaryPath, payload, { mode: 0o600 });
			fs.renameSync(temporaryPath, this.filePath);
		} catch (cause) {
			fs.rmSync(temporaryPath, { force: true });
			const msg = cause instanceof Error ? cause.message : String(cause);
			throw new CliError(
				withNextSteps(
					`Could not save the credential (${msg}). Nothing was changed.`,
					`Check that your user can write to ${path.dirname(this.filePath)}`,
				),
			);
		}
	}

	/** Holds `credentials.json.lock` so two runs cannot interleave a read-modify-write. */
	private acquireLock(waitMs: number): (() => void) | undefined {
		const lockPath = `${this.filePath}.lock`;
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		const deadline = Date.now() + waitMs;
		for (;;) {
			try {
				fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
				return () => fs.rmSync(lockPath, { force: true });
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
					throw cause;
				}
			}
			try {
				if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
					fs.rmSync(lockPath, { force: true });
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() >= deadline) {
				return undefined;
			}
			sleepSync(LOCK_RETRY_MS);
		}
	}

	private mutate(
		change: (document: CredentialsDocument) => CredentialsDocument,
	): void {
		const release = this.acquireLock(LOCK_WAIT_MS);
		if (release === undefined) {
			throw new CliError(
				withNextSteps(
					"Another command is saving credentials at this moment.",
					"Wait a few seconds and run this again.",
				),
			);
		}
		try {
			this.write(change(this.read()));
		} finally {
			release();
		}
	}

	list(): Identity[] {
		return this.read().identities;
	}

	defaultAlias(): string | undefined {
		return this.read().defaultAlias;
	}

	/** The caller checks the alias exists; an unknown one would be dropped on write. */
	setDefault(alias: string): void {
		this.mutate((document) => ({ ...document, defaultAlias: alias }));
	}

	get(alias: string): Identity | undefined {
		return this.list().find((identity) => identity.alias === alias);
	}

	findByStoreId(storeId: string): Identity | undefined {
		return this.list().find((identity) => identity.data.storeId === storeId);
	}

	findByHost(host: string): Identity | undefined {
		return this.list().find(
			(identity) => storefrontHost(identity.data.storeUrl) === host,
		);
	}

	/**
	 * Replaces the entry with the same alias, or appends it. The first
	 * credential stored in an empty file becomes the default.
	 */
	put(identity: Identity): void {
		this.mutate((document) => {
			const { identities } = document;
			const index = identities.findIndex(
				(entry) => entry.alias === identity.alias,
			);
			const next = [...identities];
			if (index === -1) {
				next.push(identity);
			} else {
				next[index] = identity;
			}
			return {
				...document,
				identities: next,
				...(identities.length === 0 ? { defaultAlias: identity.alias } : {}),
			};
		});
	}

	/** Removing the default leaves the file without one, so nothing is picked silently. */
	removeIdentity(alias: string): boolean {
		let removed = false;
		this.mutate((document) => {
			const next = document.identities.filter((entry) => entry.alias !== alias);
			removed = next.length !== document.identities.length;
			return { ...document, identities: next };
		});
		return removed;
	}

	/**
	 * Drops one token and keeps the rest of the entry. An entry left with no
	 * token at all is removed: it could not authenticate anything.
	 */
	removeToken(
		alias: string,
		kind: AuthTokenKind,
	): "removed" | "emptied" | "missing" {
		let outcome: "removed" | "emptied" | "missing" = "missing";
		this.mutate((document) => ({
			...document,
			identities: document.identities.flatMap((entry) => {
				if (entry.alias !== alias || entry.tokens[kind] === undefined) {
					return [entry];
				}
				const { [kind]: _dropped, ...tokens } = entry.tokens;
				if (Object.keys(tokens).length === 0) {
					outcome = "emptied";
					return [];
				}
				outcome = "removed";
				return [{ ...entry, tokens }];
			}),
		}));
		return outcome;
	}

	/** Records use without ever failing the command: skipped when busy or unwritable. */
	touch(alias: string, now: Date = new Date()): void {
		let release: (() => void) | undefined;
		try {
			release = this.acquireLock(0);
			if (release === undefined) {
				return;
			}
			const document = this.read();
			const { identities } = document;
			const index = identities.findIndex((entry) => entry.alias === alias);
			const entry = identities[index];
			if (entry === undefined) {
				return;
			}
			identities[index] = { ...entry, lastUsedAt: now.toISOString() };
			this.write(document);
		} catch {
			return;
		} finally {
			release?.();
		}
	}
}
