import { describe, expect, it } from "vitest";
import { type ThemeDiffLocalFile, computeThemeDiff } from "./theme-api-diff";

function makeLocal(
	path: string,
	hash: string,
	overrides?: Partial<ThemeDiffLocalFile>,
): ThemeDiffLocalFile {
	return {
		path,
		full: `/theme/${path}`,
		format: "text",
		content: "",
		hash,
		...overrides,
	};
}

describe("computeThemeDiff", () => {
	it("creates a file that exists locally but not remotely", () => {
		const local = [makeLocal("sections/new.tpl", "abc123")];
		const remote = new Map<string, string>();
		const result = computeThemeDiff(local, remote);
		expect(result.toCreate).toHaveLength(1);
		expect(result.toCreate[0]?.path).toBe("sections/new.tpl");
		expect(result.toUpdate).toHaveLength(0);
		expect(result.toDelete).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});

	it("updates a file whose hash differs from remote", () => {
		const local = [makeLocal("sections/header.tpl", "newHash")];
		const remote = new Map([["sections/header.tpl", "oldHash"]]);
		const result = computeThemeDiff(local, remote);
		expect(result.toUpdate).toHaveLength(1);
		expect(result.toUpdate[0]?.path).toBe("sections/header.tpl");
		expect(result.toCreate).toHaveLength(0);
		expect(result.toDelete).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});

	it("skips a file whose hash matches remote", () => {
		const local = [makeLocal("sections/header.tpl", "sameHash")];
		const remote = new Map([["sections/header.tpl", "sameHash"]]);
		const result = computeThemeDiff(local, remote);
		expect(result.unchanged).toBe(1);
		expect(result.toCreate).toHaveLength(0);
		expect(result.toUpdate).toHaveLength(0);
		expect(result.toDelete).toHaveLength(0);
	});

	it("deletes a file that exists remotely but not locally", () => {
		const local: ThemeDiffLocalFile[] = [];
		const remote = new Map([["sections/old.tpl", "hash"]]);
		const result = computeThemeDiff(local, remote);
		expect(result.toDelete).toContain("sections/old.tpl");
		expect(result.toCreate).toHaveLength(0);
		expect(result.toUpdate).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});

	it("handles all four cases simultaneously", () => {
		const local = [
			makeLocal("sections/new.tpl", "h1"),
			makeLocal("sections/changed.tpl", "h2-new"),
			makeLocal("sections/same.tpl", "h3"),
		];
		const remote = new Map([
			["sections/changed.tpl", "h2-old"],
			["sections/same.tpl", "h3"],
			["sections/removed.tpl", "h4"],
		]);
		const result = computeThemeDiff(local, remote);
		expect(result.toCreate.map((f) => f.path)).toEqual(["sections/new.tpl"]);
		expect(result.toUpdate.map((f) => f.path)).toEqual([
			"sections/changed.tpl",
		]);
		expect(result.toDelete).toEqual(["sections/removed.tpl"]);
		expect(result.unchanged).toBe(1);
	});

	it("returns empty result when both local and remote are empty", () => {
		const result = computeThemeDiff([], new Map());
		expect(result.toCreate).toHaveLength(0);
		expect(result.toUpdate).toHaveLength(0);
		expect(result.toDelete).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});
});
