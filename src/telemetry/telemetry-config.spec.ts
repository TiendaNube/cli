import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	TELEMETRY_CONFIG_VERSION,
	TelemetryConfigManager,
	newInstallId,
} from "./telemetry-config";

let workingDir: string;
let configPath: string;

beforeEach(() => {
	workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cli-telemetry-"));
	configPath = path.join(workingDir, "nested", "config.json");
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(workingDir, { recursive: true, force: true });
});

describe("newInstallId", () => {
	it("generates distinct random ids", () => {
		expect(newInstallId()).not.toBe(newInstallId());
	});
});

describe("TelemetryConfigManager", () => {
	it("returns null when the file does not exist", () => {
		expect(new TelemetryConfigManager(configPath).Load()).toBeNull();
	});

	it("creates missing parent directories and round-trips a decision", () => {
		const manager = new TelemetryConfigManager(configPath);
		const installId = newInstallId();

		expect(
			manager.Save({
				telemetryEnabled: true,
				installId,
			}),
		).toBe(true);

		expect(manager.Load()).toEqual({
			telemetryEnabled: true,
			installId,
		});
	});

	it("stores no installId when telemetry is declined", () => {
		const manager = new TelemetryConfigManager(configPath);
		manager.Save({
			telemetryEnabled: false,
		});

		expect(manager.Load()).toEqual({
			telemetryEnabled: false,
		});
	});

	it("treats a corrupt file as absent rather than throwing", () => {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, "{ truncated");

		expect(new TelemetryConfigManager(configPath).Load()).toBeNull();
	});

	it("treats a non-object document as absent", () => {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, '"a string"');

		expect(new TelemetryConfigManager(configPath).Load()).toBeNull();
	});

	it("stamps the schema version itself so callers cannot get it wrong", () => {
		const manager = new TelemetryConfigManager(configPath);
		// A stray `configVersion` must not win: a record claiming a version it was
		// not written under would lose its identity on the next read.
		manager.Save({
			telemetryEnabled: false,
			configVersion: 99,
		} as unknown as Parameters<typeof manager.Save>[0]);

		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			configVersion: TELEMETRY_CONFIG_VERSION,
			telemetryEnabled: false,
		});
	});

	it.each([
		["an email address", "federico.rossi@tiendanube.com"],
		["a hostname", "MacBook-Pro-de-Federico.local"],
		["a store id", "1234567"],
		["an empty string", ""],
		// v1 encodes the generating host's MAC address and a timestamp.
		["a uuid v1", "d9428888-122b-11e1-b85c-61cd3cbb3210"],
		["a uuid v7", "017f22e2-79b0-7cc3-98c4-dc0c0c07398f"],
		["a non-RFC variant", "00000000-0000-4000-c000-000000000000"],
	])(
		"drops a stored installId that is not a generated uuid (%s)",
		(_name, installId) => {
			// Whatever a hand-edited or migrated file contains, only a `newInstallId()`
			// value may ever reach the `device_id` we send.
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					configVersion: TELEMETRY_CONFIG_VERSION,
					telemetryEnabled: true,
					installId,
				}),
			);

			expect(new TelemetryConfigManager(configPath).Load()).toEqual({
				telemetryEnabled: true,
			});
		},
	);

	it("keeps the choice but drops the identity from an unrecognised version", () => {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				configVersion: TELEMETRY_CONFIG_VERSION + 1,
				telemetryEnabled: false,
				installId: newInstallId(),
			}),
		);

		// Collection is on by default, so discarding the record would silently
		// re-enable it for someone who had opted out.
		expect(new TelemetryConfigManager(configPath).Load()).toEqual({
			telemetryEnabled: false,
		});
	});

	it("mints a new identity when the stored one predates the current version", () => {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				configVersion: TELEMETRY_CONFIG_VERSION + 1,
				telemetryEnabled: true,
				installId: newInstallId(),
			}),
		);

		expect(new TelemetryConfigManager(configPath).Load()).toEqual({
			telemetryEnabled: true,
		});
	});

	it("ignores a document whose telemetryEnabled is not a boolean", () => {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				configVersion: TELEMETRY_CONFIG_VERSION,
				telemetryEnabled: "yes",
			}),
		);

		expect(new TelemetryConfigManager(configPath).Load()).toBeNull();
	});

	it("overwrites an existing decision", () => {
		const manager = new TelemetryConfigManager(configPath);
		manager.Save({
			telemetryEnabled: true,
			installId: newInstallId(),
		});
		manager.Save({
			telemetryEnabled: false,
		});

		expect(manager.Load()?.telemetryEnabled).toBe(false);
		expect(manager.Load()?.installId).toBeUndefined();
	});

	it("leaves no temp files behind", () => {
		const manager = new TelemetryConfigManager(configPath);
		manager.Save({
			telemetryEnabled: false,
		});

		const leftovers = fs
			.readdirSync(path.dirname(configPath))
			.filter((entry) => entry.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it("leaves an existing decision intact and readable when the rename fails", () => {
		const manager = new TelemetryConfigManager(configPath);
		const original = {
			telemetryEnabled: false,
		};
		expect(manager.Save(original)).toBe(true);

		// Windows can fail the rename with EPERM/EBUSY while Defender or the search
		// indexer holds the target open. Falling back to a direct write could
		// truncate a decision the user already made — silently re-prompting someone
		// who had opted out — so the save must fail cleanly instead.
		vi.spyOn(fs, "renameSync").mockImplementation(() => {
			throw Object.assign(new Error("EBUSY: resource busy or locked"), {
				code: "EBUSY",
			});
		});

		expect(
			manager.Save({
				telemetryEnabled: true,
				installId: newInstallId(),
			}),
		).toBe(false);

		vi.restoreAllMocks();

		expect(manager.Load()).toEqual(original);
		expect(
			fs
				.readdirSync(path.dirname(configPath))
				.filter((entry) => entry.endsWith(".tmp")),
		).toEqual([]);
	});

	it("reports failure instead of throwing when the path is unwritable", () => {
		// A file where the parent directory must go: mkdir cannot succeed.
		const blocker = path.join(workingDir, "blocker");
		fs.writeFileSync(blocker, "");

		const manager = new TelemetryConfigManager(
			path.join(blocker, "config.json"),
		);
		expect(
			manager.Save({
				telemetryEnabled: true,
				installId: newInstallId(),
			}),
		).toBe(false);
	});
});
