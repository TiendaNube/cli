import { describe, expect, it } from "vitest";
import {
	crossFamilyForcedNotice,
	crossFamilyPushRefusal,
	crossFamilyWatchRefusal,
} from "./theme-workspace-sync-origin";

describe("crossFamilyPushRefusal", () => {
	it("allows a push when no origin was ever recorded", () => {
		// Every pre-existing workspace, and anything cloned from git, is here.
		// Unknown is not the same as wrong.
		expect(
			crossFamilyPushRefusal({ target: "api", lastSync: undefined }),
		).toBeNull();
		expect(
			crossFamilyPushRefusal({ target: "ftp", lastSync: undefined }),
		).toBeNull();
	});

	it("allows a push when the origin matches the target", () => {
		expect(
			crossFamilyPushRefusal({ target: "api", lastSync: "api" }),
		).toBeNull();
		expect(
			crossFamilyPushRefusal({ target: "ftp", lastSync: "ftp" }),
		).toBeNull();
	});

	it("refuses an API push of files pulled over FTP", () => {
		const message = crossFamilyPushRefusal({ target: "api", lastSync: "ftp" });
		expect(message).not.toBeNull();
		expect(message).toMatch(/last pulled over FTP/);
		expect(message).toMatch(/upload them over Public API/);
	});

	it("refuses an FTP push of files pulled over the API", () => {
		const message = crossFamilyPushRefusal({ target: "ftp", lastSync: "api" });
		expect(message).not.toBeNull();
		expect(message).toMatch(/last pulled over Public API/);
		expect(message).toMatch(/upload them over FTP/);
	});

	it("names both ways out: pull first, or --force", () => {
		const message = crossFamilyPushRefusal({ target: "ftp", lastSync: "api" });
		expect(message).toMatch(/theme ftp pull/);
		expect(message).toMatch(/--force/);
	});

	it("points at the pull command of the family being pushed to", () => {
		expect(crossFamilyPushRefusal({ target: "api", lastSync: "ftp" })).toMatch(
			/theme pull/,
		);
	});
});

describe("crossFamilyWatchRefusal", () => {
	it("allows the same cases a push allows", () => {
		expect(
			crossFamilyWatchRefusal({ target: "api", lastSync: undefined }),
		).toBeNull();
		expect(
			crossFamilyWatchRefusal({ target: "ftp", lastSync: "ftp" }),
		).toBeNull();
	});

	it("refuses a cross-family watch without offering --force", () => {
		// A watch pushes on every save; there is no override flag by design.
		const message = crossFamilyWatchRefusal({ target: "ftp", lastSync: "api" });
		expect(message).not.toBeNull();
		expect(message).toMatch(/on every save/);
		expect(message).not.toMatch(/--force/);
		expect(message).toMatch(/theme ftp pull/);
	});
});

describe("crossFamilyForcedNotice", () => {
	it("is empty when there is nothing to warn about", () => {
		expect(crossFamilyForcedNotice({ target: "api", lastSync: "api" })).toBe(
			"",
		);
		expect(
			crossFamilyForcedNotice({ target: "api", lastSync: undefined }),
		).toBe("");
	});

	it("names the mismatch so --force is never silent to a human", () => {
		// --force unlocks the push; the confirmation still states the situation, so
		// only `--force -y` together skip the warning.
		const notice = crossFamilyForcedNotice({ target: "ftp", lastSync: "api" });
		expect(notice).toMatch(/last pulled over Public API/);
		expect(notice).toMatch(/--force/);
		expect(notice).toMatch(/over FTP/);
	});
});
