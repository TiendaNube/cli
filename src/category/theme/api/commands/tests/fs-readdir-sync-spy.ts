import fs from "node:fs";
import type { PathLike } from "node:fs";
import type { MockInstance } from "vitest";
import { vi } from "vitest";

/** Overload de `readdirSync` que devolve nomes (`string[]`), sem `withFileTypes: true`. */
type ReaddirSyncAsNames = (
	path: PathLike,
	options?:
		| { encoding?: BufferEncoding | null; withFileTypes?: false }
		| BufferEncoding
		| null,
) => string[];

/**
 * Spy de `readdirSync` com `mockReturnValue` em `string[]`.
 * Não usar `MockInstance<typeof readdirSync>`: os overloads unem-se e o TS pode exigir `Dirent[]`.
 */
export type FsReaddirSyncSpy = MockInstance<ReaddirSyncAsNames>;

/** `vi.spyOn(fs, "readdirSync")` + `mockReturnValue(names)` com tipagem estável. */
export function spyFsReaddirSyncMockNames(names: string[]): FsReaddirSyncSpy {
	const spy = vi.spyOn(fs, "readdirSync") as unknown as FsReaddirSyncSpy;
	spy.mockReturnValue(names);
	return spy;
}
