/**
 * Minimal line-level diff producing git-compatible unified patches. Implemented
 * in-house (Myers greedy path with a common prefix/suffix shortcut) to keep the
 * CLI dependency-free.
 */

/** Lines of leading/trailing context kept around each change. */
const DEFAULT_CONTEXT = 3;
/** Maximum patch body lines emitted per file before truncating. */
const DEFAULT_MAX_PATCH_LINES = 500;
/**
 * Maximum Myers edit distance before falling back to a whole-file rewrite. The
 * trace holds one O(distance) snapshot per distance, so this cap also bounds peak
 * memory (~8 MB here; 4000 would retain ~128 MB before giving up).
 */
const DEFAULT_MAX_EDIT_DISTANCE = 1000;

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export type UnifiedDiffNote = "line_endings_differ" | null;

export type UnifiedDiff = {
	/** Full patch (`---`/`+++` headers plus hunks), or `""` when there is no textual change. */
	patch: string;
	linesAdded: number;
	linesRemoved: number;
	/**
	 * The patch body hit the per-file budget and does not list every change. Hunk
	 * headers still describe the full hunk even when its body was cut, which is
	 * fine for a display-only patch.
	 */
	truncated: boolean;
	note: UnifiedDiffNote;
};

export type UnifiedDiffOptions = {
	oldLabel: string;
	newLabel: string;
	context?: number;
	maxPatchLines?: number;
	maxEditDistance?: number;
};

type OpType = "equal" | "add" | "remove";

type Op = {
	type: OpType;
	/** Index into the old lines (for `equal`/`remove`). */
	oldIndex: number;
	/** Index into the new lines (for `equal`/`add`). */
	newIndex: number;
};

type SplitText = {
	lines: string[];
	hasTrailingNewline: boolean;
};

function normalizeEol(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

/** Splits into lines, keeping the trailing-newline state out of the content. */
function splitLines(text: string): SplitText {
	if (text === "") {
		return { lines: [], hasTrailingNewline: true };
	}
	const hasTrailingNewline = text.endsWith("\n");
	const lines = text.split("\n");
	if (hasTrailingNewline) {
		lines.pop();
	}
	return { lines, hasTrailingNewline };
}

export function countTextLines(text: string): number {
	return splitLines(normalizeEol(text)).lines.length;
}

/**
 * Myers greedy forward path. Returns `null` when the edit distance exceeds
 * `maxEditDistance`, letting callers degrade to a whole-file rewrite.
 */
function myersOps(
	a: string[],
	b: string[],
	maxEditDistance: number,
): Op[] | null {
	const n = a.length;
	const m = b.length;
	const max = Math.min(n + m, maxEditDistance);
	const offset = max + 1;
	const size = 2 * max + 3;
	const v = new Int32Array(size).fill(-1);
	v[offset + 1] = 0;
	// One snapshot of the furthest-reaching paths per edit distance, so the edit
	// script can be recovered by walking back from the end.
	const trace: Int32Array[] = [];

	for (let d = 0; d <= max; d += 1) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			const goDown =
				k === -d ||
				(k !== d && (v[offset + k - 1] ?? -1) < (v[offset + k + 1] ?? -1));
			let x = goDown ? v[offset + k + 1] ?? 0 : (v[offset + k - 1] ?? 0) + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x += 1;
				y += 1;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				return backtrack(trace, a, b, offset);
			}
		}
	}
	return null;
}

function backtrack(
	trace: Int32Array[],
	a: string[],
	b: string[],
	offset: number,
): Op[] {
	const ops: Op[] = [];
	let x = a.length;
	let y = b.length;

	for (let d = trace.length - 1; d >= 0; d -= 1) {
		const v = trace[d];
		if (!v) continue;
		const k = x - y;
		const goDown =
			k === -d ||
			(k !== d && (v[offset + k - 1] ?? -1) < (v[offset + k + 1] ?? -1));
		const prevK = goDown ? k + 1 : k - 1;
		const prevX = v[offset + prevK] ?? 0;
		const prevY = prevX - prevK;

		while (x > prevX && y > prevY) {
			ops.push({ type: "equal", oldIndex: x - 1, newIndex: y - 1 });
			x -= 1;
			y -= 1;
		}
		if (d > 0) {
			if (x === prevX) {
				ops.push({ type: "add", oldIndex: x, newIndex: y - 1 });
			} else {
				ops.push({ type: "remove", oldIndex: x - 1, newIndex: y });
			}
			x = prevX;
			y = prevY;
		}
	}

	ops.reverse();
	return ops;
}

/** Diffs the two line arrays, trimming the common prefix/suffix first. */
function computeOps(
	oldLines: string[],
	newLines: string[],
	maxEditDistance: number,
): { ops: Op[]; overflow: boolean } {
	let prefix = 0;
	while (
		prefix < oldLines.length &&
		prefix < newLines.length &&
		oldLines[prefix] === newLines[prefix]
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < oldLines.length - prefix &&
		suffix < newLines.length - prefix &&
		oldLines[oldLines.length - 1 - suffix] ===
			newLines[newLines.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const middleOld = oldLines.slice(prefix, oldLines.length - suffix);
	const middleNew = newLines.slice(prefix, newLines.length - suffix);
	const middleOps = myersOps(middleOld, middleNew, maxEditDistance);

	const ops: Op[] = [];
	for (let i = 0; i < prefix; i += 1) {
		ops.push({ type: "equal", oldIndex: i, newIndex: i });
	}

	if (middleOps === null) {
		// Too many edits to describe precisely — rewrite the whole middle block.
		for (let i = 0; i < middleOld.length; i += 1) {
			ops.push({
				type: "remove",
				oldIndex: prefix + i,
				newIndex: prefix,
			});
		}
		for (let i = 0; i < middleNew.length; i += 1) {
			ops.push({
				type: "add",
				oldIndex: oldLines.length - suffix,
				newIndex: prefix + i,
			});
		}
	} else {
		for (const op of middleOps) {
			ops.push({
				type: op.type,
				oldIndex: op.oldIndex + prefix,
				newIndex: op.newIndex + prefix,
			});
		}
	}

	for (let i = 0; i < suffix; i += 1) {
		ops.push({
			type: "equal",
			oldIndex: oldLines.length - suffix + i,
			newIndex: newLines.length - suffix + i,
		});
	}

	return { ops, overflow: middleOps === null };
}

/**
 * Git attaches `\ No newline at end of file` to the last line of whichever side
 * lacks the trailing newline. When exactly one side lacks it and that line sits in
 * an `equal` op, plain context cannot express the difference, so the op is split
 * into a remove/add pair that can carry the marker. Returns `null` when no split
 * is needed.
 */
function splitTrailingEqualOp(
	ops: Op[],
	oldSide: SplitText,
	newSide: SplitText,
): Op[] | null {
	if (oldSide.hasTrailingNewline === newSide.hasTrailingNewline) {
		return null;
	}
	const oldLacksNewline = !oldSide.hasTrailingNewline;
	// The op covering a side's last line is the last one that side takes part in.
	const absent: OpType = oldLacksNewline ? "add" : "remove";
	let index = -1;
	for (let i = ops.length - 1; i >= 0; i -= 1) {
		if (ops[i]?.type !== absent) {
			index = i;
			break;
		}
	}
	const target = ops[index];
	if (target === undefined || target.type !== "equal") {
		// Already a remove/add, which `renderHunks` annotates on its own.
		return null;
	}

	const remove: Op = {
		type: "remove",
		oldIndex: target.oldIndex,
		newIndex: target.newIndex,
	};
	const add: Op = {
		type: "add",
		oldIndex: target.oldIndex + 1,
		newIndex: target.newIndex,
	};
	const before = ops.slice(0, index);
	const after = ops.slice(index + 1);
	// Match git's ordering, which keeps the marker at the end of the annotated
	// side's run: before the trailing adds when the old side lacks the newline,
	// after the trailing removes when the new side does.
	return oldLacksNewline
		? [...before, remove, add, ...after]
		: [...before, remove, ...after, add];
}

/**
 * Stably reorders each contiguous run of changes to removes-then-adds, the layout
 * git emits. Unified diffs rebuild the old side from ` `/`-` lines and the new one
 * from ` `/`+` lines, so a stable partition inside a run changes nothing but the
 * reading order — and it keeps `\ No newline at end of file` attached to the last
 * line of its own side's run.
 */
function groupChangeRuns(ops: Op[]): Op[] {
	const grouped: Op[] = [];
	let index = 0;
	while (index < ops.length) {
		const op = ops[index];
		if (op === undefined) break;
		if (op.type === "equal") {
			grouped.push(op);
			index += 1;
			continue;
		}
		let end = index;
		while (end < ops.length && ops[end]?.type !== "equal") {
			end += 1;
		}
		const run = ops.slice(index, end);
		grouped.push(
			...run.filter((o) => o.type === "remove"),
			...run.filter((o) => o.type === "add"),
		);
		index = end;
	}
	return grouped;
}

type Hunk = { start: number; end: number };

/** Groups changed ops into hunks, merging groups that share context. */
function buildHunks(ops: Op[], context: number): Hunk[] {
	const hunks: Hunk[] = [];
	let index = 0;
	while (index < ops.length) {
		if (ops[index]?.type === "equal") {
			index += 1;
			continue;
		}
		const start = Math.max(0, index - context);
		let lastChange = index;
		let cursor = index;
		while (cursor < ops.length) {
			if (ops[cursor]?.type !== "equal") {
				lastChange = cursor;
				cursor += 1;
				continue;
			}
			// Keep scanning while the next change is close enough to share context.
			let gap = 0;
			while (cursor + gap < ops.length && ops[cursor + gap]?.type === "equal") {
				gap += 1;
			}
			if (cursor + gap >= ops.length || gap > context * 2) {
				break;
			}
			cursor += gap;
		}
		const end = Math.min(ops.length, lastChange + context + 1);
		const previous = hunks[hunks.length - 1];
		if (previous && start <= previous.end) {
			previous.end = end;
		} else {
			hunks.push({ start, end });
		}
		index = end;
	}
	return hunks;
}

function renderHunks(
	ops: Op[],
	hunks: Hunk[],
	oldSide: SplitText,
	newSide: SplitText,
	maxPatchLines: number,
): { body: string[]; truncated: boolean } {
	const body: string[] = [];
	let truncated = false;

	for (const hunk of hunks) {
		const slice = ops.slice(hunk.start, hunk.end);
		let oldCount = 0;
		let newCount = 0;
		let oldStart = 0;
		let newStart = 0;
		for (const op of slice) {
			if (op.type !== "add") {
				if (oldCount === 0) oldStart = op.oldIndex + 1;
				oldCount += 1;
			}
			if (op.type !== "remove") {
				if (newCount === 0) newStart = op.newIndex + 1;
				newCount += 1;
			}
		}

		// A header with no body line under it says nothing, so stop before pushing
		// one. Hunks larger than the remaining budget are cut mid-way instead of
		// dropped, otherwise an over-budget first hunk would leave `body` empty and
		// `patchWithHeader` would return `""` — the signal for "no textual change".
		if (body.length + 2 > maxPatchLines) {
			truncated = true;
			break;
		}

		body.push(
			`@@ -${oldCount === 0 ? 0 : oldStart},${oldCount} +${newCount === 0 ? 0 : newStart},${newCount} @@`,
		);
		for (const op of slice) {
			if (body.length >= maxPatchLines) {
				return { body, truncated: true };
			}
			if (op.type === "add") {
				body.push(`+${newSide.lines[op.newIndex] ?? ""}`);
				if (
					op.newIndex === newSide.lines.length - 1 &&
					!newSide.hasTrailingNewline
				) {
					body.push(NO_NEWLINE_MARKER);
				}
				continue;
			}
			if (op.type === "remove") {
				body.push(`-${oldSide.lines[op.oldIndex] ?? ""}`);
				if (
					op.oldIndex === oldSide.lines.length - 1 &&
					!oldSide.hasTrailingNewline
				) {
					body.push(NO_NEWLINE_MARKER);
				}
				continue;
			}
			body.push(` ${oldSide.lines[op.oldIndex] ?? ""}`);
			const lastOnBothSides =
				op.oldIndex === oldSide.lines.length - 1 &&
				op.newIndex === newSide.lines.length - 1;
			if (
				lastOnBothSides &&
				!oldSide.hasTrailingNewline &&
				!newSide.hasTrailingNewline
			) {
				body.push(NO_NEWLINE_MARKER);
			}
		}
	}

	return { body, truncated };
}

/**
 * Builds a unified patch from `oldText` to `newText`. An empty `patch` means the
 * two sides are textually identical (see `note` for the EOL-only case).
 */
export function computeUnifiedDiff(
	oldText: string,
	newText: string,
	options: UnifiedDiffOptions,
): UnifiedDiff {
	const context = options.context ?? DEFAULT_CONTEXT;
	const maxPatchLines = options.maxPatchLines ?? DEFAULT_MAX_PATCH_LINES;
	const maxEditDistance = options.maxEditDistance ?? DEFAULT_MAX_EDIT_DISTANCE;

	const empty: UnifiedDiff = {
		patch: "",
		linesAdded: 0,
		linesRemoved: 0,
		truncated: false,
		note: null,
	};

	if (oldText === newText) {
		return empty;
	}
	const normalizedOld = normalizeEol(oldText);
	const normalizedNew = normalizeEol(newText);
	if (normalizedOld === normalizedNew) {
		// Only the line endings differ: a line diff would be empty and a byte diff
		// would be unreadable, so report the reason instead.
		return { ...empty, note: "line_endings_differ" };
	}

	const oldSide = splitLines(normalizedOld);
	const newSide = splitLines(normalizedNew);

	const { ops: lineOps, overflow } = computeOps(
		oldSide.lines,
		newSide.lines,
		maxEditDistance,
	);
	// A trailing newline present on one side only is a real difference even when
	// the last line itself is unchanged, so it gets its own remove/add pair.
	const ops = groupChangeRuns(
		splitTrailingEqualOp(lineOps, oldSide, newSide) ?? lineOps,
	);

	let linesAdded = 0;
	let linesRemoved = 0;
	for (const op of ops) {
		if (op.type === "add") linesAdded += 1;
		if (op.type === "remove") linesRemoved += 1;
	}
	if (linesAdded === 0 && linesRemoved === 0) {
		// Identical lines and matching newline states leave nothing to render.
		return empty;
	}

	const rendered = renderHunks(
		ops,
		buildHunks(ops, context),
		oldSide,
		newSide,
		maxPatchLines,
	);

	return {
		patch: patchWithHeader(options, rendered.body),
		linesAdded,
		linesRemoved,
		truncated: rendered.truncated || overflow,
		note: null,
	};
}

function patchWithHeader(options: UnifiedDiffOptions, body: string[]): string {
	if (body.length === 0) {
		return "";
	}
	return [`--- ${options.oldLabel}`, `+++ ${options.newLabel}`, ...body].join(
		"\n",
	);
}
