import type { MockInstance } from "vitest";

/** Tipo do spy de `vi.spyOn(process.stderr, "write")`. */
export type StderrWriteSpy = MockInstance<typeof process.stderr.write>;
