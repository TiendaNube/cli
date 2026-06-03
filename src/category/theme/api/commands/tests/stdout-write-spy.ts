import type { MockInstance } from "vitest";

/** Tipo do spy de `vi.spyOn(process.stdout, "write")`. */
export type StdoutWriteSpy = MockInstance<typeof process.stdout.write>;
