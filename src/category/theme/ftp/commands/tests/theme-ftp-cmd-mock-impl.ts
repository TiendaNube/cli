import { vi } from "vitest";

export const ftpCmdMocks = {
	isSet: false,
	tryLoadResult: { success: false, error: "bad" } as
		| {
				success: true;
				config: { ftp: Record<string, unknown>; storeUrl: string };
		  }
		| { success: false; error: string },
	save: vi.fn(),
	log: vi.fn(),
	error: vi.fn(),
	confirm: vi.fn().mockResolvedValue(true),
	testFtp: vi.fn(),
	downloadAll: vi.fn(),
	syncAll: vi.fn(),
	upload: vi.fn(),
	delete: vi.fn(),
};
