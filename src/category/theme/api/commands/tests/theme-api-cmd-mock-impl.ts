import { vi } from "vitest";

/** Mutable state + spies (not `vi.hoisted` — safe to export). */
export const themeApiCmdMocks = {
	tryLoadResult: { success: false, error: "no config" } as
		| { success: true; config: Record<string, unknown> }
		| { success: false; error: string },
	mergeWorkspace: vi.fn(),
	isSet: false,
	readWorkspaceReturn: {} as Record<string, unknown>,
	log: vi.fn(),
	error: vi.fn(),
	confirm: vi.fn().mockResolvedValue(true),
	input: vi.fn().mockResolvedValue(""),
	listInstallations: vi.fn(),
	getInstallation: vi.fn(),
	createInstallation: vi.fn(),
	deleteInstallation: vi.fn(),
	publishInstallation: vi.fn(),
	forkInstallation: vi.fn(),
	cloneInstallation: vi.fn(),
	getFiles: vi.fn(),
	getFileHashes: vi.fn(),
	upsertFile: vi.fn(),
	deleteFile: vi.fn(),
	batchUpdateFiles: vi.fn(),
};
