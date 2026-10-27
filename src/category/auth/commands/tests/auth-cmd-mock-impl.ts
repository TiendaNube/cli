import { vi } from "vitest";

/** Mutable state + spies (not `vi.hoisted` — safe to export). */
export const authCmdMocks = {
	log: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	confirm: vi.fn().mockResolvedValue(true),
	input: vi.fn().mockResolvedValue(""),
	password: vi.fn().mockResolvedValue(""),
	listInstallations: vi.fn(),
	ftpTest: vi.fn(),
	openSystemBrowser: vi.fn(),
	puppeteerLaunch: vi.fn(),
	bin: "tiendanube",
};
