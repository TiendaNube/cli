import { describe, expect, it } from "vitest";
import { computeUnifiedDiff, countTextLines } from "./theme-api-text-diff";

const labels = { oldLabel: "remote/a.tpl", newLabel: "local/a.tpl" };

describe("computeUnifiedDiff", () => {
	it("returns an empty patch for identical content", () => {
		const result = computeUnifiedDiff("a\nb\n", "a\nb\n", labels);
		expect(result).toEqual({
			patch: "",
			linesAdded: 0,
			linesRemoved: 0,
			truncated: false,
			note: null,
		});
	});

	it("reports an EOL-only difference without a patch", () => {
		const result = computeUnifiedDiff("a\r\nb\r\n", "a\nb\n", labels);
		expect(result.note).toBe("line_endings_differ");
		expect(result.patch).toBe("");
		expect(result.linesAdded).toBe(0);
		expect(result.linesRemoved).toBe(0);
	});

	it("emits a hunk with headers and context for a mid-file replacement", () => {
		const oldText = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
		const newText = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9\n";
		const result = computeUnifiedDiff(oldText, newText, labels);
		expect(result.linesAdded).toBe(1);
		expect(result.linesRemoved).toBe(1);
		expect(result.truncated).toBe(false);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -2,7 +2,7 @@",
				" 2",
				" 3",
				" 4",
				"-5",
				"+FIVE",
				" 6",
				" 7",
				" 8",
			].join("\n"),
		);
	});

	it("handles a pure insertion", () => {
		const result = computeUnifiedDiff("a\nb\n", "a\nnew\nb\n", labels);
		expect(result.linesAdded).toBe(1);
		expect(result.linesRemoved).toBe(0);
		expect(result.patch).toContain("@@ -1,2 +1,3 @@");
		expect(result.patch).toContain("+new");
		expect(result.patch).not.toContain("\n-");
	});

	it("handles a pure deletion", () => {
		const result = computeUnifiedDiff("a\ngone\nb\n", "a\nb\n", labels);
		expect(result.linesAdded).toBe(0);
		expect(result.linesRemoved).toBe(1);
		expect(result.patch).toContain("-gone");
	});

	it("creates an add-only patch when the old side is empty", () => {
		const result = computeUnifiedDiff("", "a\nb\n", {
			oldLabel: "/dev/null",
			newLabel: "local/a.tpl",
		});
		expect(result.linesAdded).toBe(2);
		expect(result.linesRemoved).toBe(0);
		expect(result.patch).toBe(
			["--- /dev/null", "+++ local/a.tpl", "@@ -0,0 +1,2 @@", "+a", "+b"].join(
				"\n",
			),
		);
	});

	it("creates a remove-only patch when the new side is empty", () => {
		const result = computeUnifiedDiff("a\nb\n", "", {
			oldLabel: "remote/a.tpl",
			newLabel: "/dev/null",
		});
		expect(result.linesRemoved).toBe(2);
		expect(result.patch).toBe(
			["--- remote/a.tpl", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b"].join(
				"\n",
			),
		);
	});

	it("keeps distant changes in separate hunks", () => {
		const oldLines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
		const newLines = [...oldLines];
		newLines[1] = "changed top";
		newLines[35] = "changed bottom";
		const result = computeUnifiedDiff(
			`${oldLines.join("\n")}\n`,
			`${newLines.join("\n")}\n`,
			labels,
		);
		const hunkHeaders = result.patch
			.split("\n")
			.filter((line) => line.startsWith("@@"));
		expect(hunkHeaders).toHaveLength(2);
		expect(result.linesAdded).toBe(2);
		expect(result.linesRemoved).toBe(2);
	});

	it("merges nearby changes into a single hunk", () => {
		const oldLines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
		const newLines = [...oldLines];
		newLines[5] = "a";
		newLines[7] = "b";
		const result = computeUnifiedDiff(
			`${oldLines.join("\n")}\n`,
			`${newLines.join("\n")}\n`,
			labels,
		);
		const hunkHeaders = result.patch
			.split("\n")
			.filter((line) => line.startsWith("@@"));
		expect(hunkHeaders).toHaveLength(1);
	});

	it("marks a missing trailing newline", () => {
		const result = computeUnifiedDiff("a\nb\n", "a\nb", labels);
		expect(result.patch).toContain("\\ No newline at end of file");
		expect(result.linesAdded).toBe(1);
		expect(result.linesRemoved).toBe(1);
	});

	// A trailing newline on one side only is a real difference even when the last
	// line is unchanged. Expectations below match `git diff --no-index` byte for
	// byte, including where the marker sits relative to the surrounding lines.
	it("marks a trailing newline the local side added, past the last change", () => {
		const result = computeUnifiedDiff("x\na\nb", "y\na\nb\n", labels);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -1,3 +1,3 @@",
				"-x",
				"+y",
				" a",
				"-b",
				"\\ No newline at end of file",
				"+b",
			].join("\n"),
		);
		expect(result.linesAdded).toBe(2);
		expect(result.linesRemoved).toBe(2);
	});

	it("marks a trailing newline the local side dropped, past the last change", () => {
		const result = computeUnifiedDiff("x\na\nb\n", "y\na\nb", labels);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -1,3 +1,3 @@",
				"-x",
				"+y",
				" a",
				"-b",
				"+b",
				"\\ No newline at end of file",
			].join("\n"),
		);
	});

	it("keeps the marker after the trailing removes", () => {
		const result = computeUnifiedDiff("a\nb\nc\n", "a\nb", labels);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -1,3 +1,2 @@",
				" a",
				"-b",
				"-c",
				"+b",
				"\\ No newline at end of file",
			].join("\n"),
		);
	});

	it("keeps the marker before the trailing adds", () => {
		const result = computeUnifiedDiff("a\nb", "a\nb\nc\n", labels);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -1,2 +1,3 @@",
				" a",
				"-b",
				"\\ No newline at end of file",
				"+b",
				"+c",
			].join("\n"),
		);
	});

	it("merges the forced last line into the adjacent change run", () => {
		// The split pair must not interleave with the change right above it: git
		// groups every run as all removes, then all adds.
		const result = computeUnifiedDiff(
			"p old\nfooter",
			"p new\nfooter\n",
			labels,
		);
		expect(result.patch).toBe(
			[
				"--- remote/a.tpl",
				"+++ local/a.tpl",
				"@@ -1,2 +1,2 @@",
				"-p old",
				"-footer",
				"\\ No newline at end of file",
				"+p new",
				"+footer",
			].join("\n"),
		);
	});

	it("keeps a single marker when neither side has a trailing newline", () => {
		const result = computeUnifiedDiff("a\nx\nb", "a\ny\nb", labels);
		expect(
			result.patch.split("\n").filter((l) => l.startsWith("\\")),
		).toHaveLength(1);
		expect(result.patch.endsWith(" b\n\\ No newline at end of file")).toBe(
			true,
		);
	});

	it("truncates the patch body when it exceeds the budget", () => {
		const oldText = `${Array.from({ length: 200 }, (_, i) => `old ${i}`).join("\n")}\n`;
		const newText = `${Array.from({ length: 200 }, (_, i) => `new ${i}`).join("\n")}\n`;
		const result = computeUnifiedDiff(oldText, newText, {
			...labels,
			maxPatchLines: 20,
		});
		expect(result.truncated).toBe(true);
		// The body is cut inside the hunk, never dropped entirely: an empty patch
		// means "no textual change" and would hide the diff completely.
		expect(result.patch).toContain("@@");
		expect(result.patch).toContain("-old 0");
		expect(result.patch.split("\n").length).toBeLessThanOrEqual(23);
		// Counts stay complete even though the body is cut.
		expect(result.linesAdded).toBe(200);
		expect(result.linesRemoved).toBe(200);
	});

	it("falls back to a whole-file rewrite when the edit distance overflows", () => {
		const oldText = `${Array.from({ length: 60 }, (_, i) => `old ${i}`).join("\n")}\n`;
		const newText = `${Array.from({ length: 60 }, (_, i) => `new ${i}`).join("\n")}\n`;
		const result = computeUnifiedDiff(oldText, newText, {
			...labels,
			maxEditDistance: 10,
		});
		expect(result.truncated).toBe(true);
		expect(result.linesRemoved).toBe(60);
		expect(result.linesAdded).toBe(60);
	});

	it("produces a patch that reconstructs the new content", () => {
		const oldText = "alpha\nbeta\ngamma\ndelta\n";
		const newText = "alpha\nBETA\ngamma\ndelta\nepsilon\n";
		const result = computeUnifiedDiff(oldText, newText, labels);
		const applied: string[] = [];
		for (const line of result.patch.split("\n")) {
			if (
				line.startsWith("@@") ||
				line.startsWith("---") ||
				line.startsWith("+++")
			) {
				continue;
			}
			if (line.startsWith("+")) applied.push(line.slice(1));
			if (line.startsWith(" ")) applied.push(line.slice(1));
		}
		expect(applied).toEqual(["alpha", "BETA", "gamma", "delta", "epsilon"]);
	});
});

describe("countTextLines", () => {
	it("counts lines regardless of the trailing newline", () => {
		expect(countTextLines("")).toBe(0);
		expect(countTextLines("a")).toBe(1);
		expect(countTextLines("a\n")).toBe(1);
		expect(countTextLines("a\nb\n")).toBe(2);
		expect(countTextLines("a\r\nb")).toBe(2);
	});
});
