import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveUserConfigPath } from "./telemetry-config-path";

/**
 * Bumped when the shape of this file changes.
 *
 * A record written under any other version keeps only `telemetryEnabled`, and its
 * `installId` is dropped so a fresh one is minted. Discarding the whole record
 * would be worse than losing one machine's continuity in a chart: collection is on
 * by default, so an unreadable version would silently start reporting again for
 * someone who had opted out.
 *
 * Written by `Save` rather than by its callers, so a wrong version cannot reach
 * the disk. Impossible to retrofit later, hence present from the first version.
 */
export const TELEMETRY_CONFIG_VERSION = 1;

/**
 * Shape of a `newInstallId()` value.
 *
 * `Load` accepts nothing else, so a hand-edited or migrated config file cannot
 * smuggle an email address, a hostname or a store id into the `device_id` we send.
 * An id that fails this is dropped and a fresh one is minted.
 *
 * Pinned to version 4 and the RFC variant, which is all `crypto.randomUUID()`
 * ever produces. Accepting any version would let a v1 value through, and those
 * encode the generating host's MAC address and a timestamp — exactly the kind of
 * machine fact this identifier exists to avoid carrying.
 */
const INSTALL_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The user's choice, as stored. The schema version is `Save`'s business. */
export type TelemetryConfig = {
	telemetryEnabled: boolean;
	/** Random and anonymous. Absent while telemetry is disabled. */
	installId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Anonymous identity for the Amplitude `device_id`. Carries no machine facts by design. */
export function newInstallId(): string {
	return crypto.randomUUID();
}

/**
 * Reads and writes the per-user telemetry configuration.
 *
 * Every operation is best-effort: this file is bookkeeping for an optional
 * feature, so a read-only HOME, a corrupt file or a Windows lock must degrade
 * quietly — see `mintPersistentIdentity` for what a failed write costs — and never
 * surface an error to the command the user actually ran.
 */
export class TelemetryConfigManager {
	public constructor(
		private readonly configFilePath: string = resolveUserConfigPath(),
	) {}

	get FilePath(): string {
		return this.configFilePath;
	}

	/**
	 * The stored choice, or `null` when the file is absent, unreadable, corrupt, or
	 * does not record a choice at all.
	 */
	Load(): TelemetryConfig | null {
		let raw: string;
		try {
			raw = fs.readFileSync(this.configFilePath, "utf8");
		} catch {
			return null;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// A truncated or hand-edited file is treated as absent and rewritten on
			// the next Save, rather than breaking every subsequent run.
			return null;
		}
		if (!isRecord(parsed)) {
			return null;
		}

		const { configVersion, telemetryEnabled, installId } = parsed;
		if (typeof telemetryEnabled !== "boolean") {
			return null;
		}

		// See TELEMETRY_CONFIG_VERSION: an unrecognised version keeps the choice and
		// gives up only the identity.
		const storedId =
			configVersion === TELEMETRY_CONFIG_VERSION &&
			typeof installId === "string" &&
			INSTALL_ID_PATTERN.test(installId)
				? installId
				: undefined;

		return {
			telemetryEnabled,
			...(storedId !== undefined ? { installId: storedId } : {}),
		};
	}

	/** Persists the decision atomically. Returns false when it could not be stored. */
	Save(config: TelemetryConfig): boolean {
		// Version last, so it is the manager's to set and not something a caller can
		// override by passing a stray property through.
		const document = { ...config, configVersion: TELEMETRY_CONFIG_VERSION };
		const payload = `${JSON.stringify(document, null, 2)}\n`;
		// Temp file in the same directory keeps the rename on one filesystem, so two
		// concurrent runs (a `theme watch` and a `theme push`) can never observe a
		// half-written file.
		const temporaryPath = `${this.configFilePath}.${process.pid}.tmp`;

		try {
			// `mode` is silently ignored on Windows, which is fine: %APPDATA% is
			// already scoped to the user by ACL inheritance.
			fs.mkdirSync(path.dirname(this.configFilePath), {
				recursive: true,
				mode: 0o700,
			});
			fs.writeFileSync(temporaryPath, payload, { mode: 0o600 });
			fs.renameSync(temporaryPath, this.configFilePath);
			return true;
		} catch {
			this.discardTemporaryFile(temporaryPath);
			return false;
		}
	}

	/**
	 * Cleans up after a failed save without touching `configFilePath`.
	 *
	 * Deliberately no non-atomic fallback write. Where the rename realistically
	 * fails — Windows EPERM/EBUSY while Defender or the search indexer holds the
	 * target open — a direct write to that same target would almost certainly fail
	 * too, and a partial one would truncate a choice the user already made, silently
	 * re-enabling collection for someone who had opted out. Leaving the existing
	 * file untouched and returning `false` is the safe outcome.
	 */
	private discardTemporaryFile(temporaryPath: string): void {
		try {
			fs.rmSync(temporaryPath, { force: true });
		} catch {
			// The decision was not stored either way; a stray temp file is harmless.
			return;
		}
	}
}
