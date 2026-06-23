import { vi } from "vitest";
import { ftpCmdMocks } from "./theme-ftp-cmd-mock-impl";

vi.mock("../../theme-ftp-config-manager", () => ({
	ThemeFtpConfigManager: vi.fn().mockImplementation(() => ({
		IsSet: () => ftpCmdMocks.isSet,
		TryLoad: () => ftpCmdMocks.tryLoadResult,
		Save: ftpCmdMocks.save,
	})),
}));

vi.mock("../../theme-ftp-client", () => ({
	ThemeFtpClient: vi.fn().mockImplementation(() => ({
		Test: ftpCmdMocks.testFtp,
		DownloadAll: ftpCmdMocks.downloadAll,
		SyncAll: ftpCmdMocks.syncAll,
		Upload: ftpCmdMocks.upload,
		Delete: ftpCmdMocks.delete,
	})),
}));

vi.mock("../../../../../cli-logger", () => ({
	CliLogger: vi.fn().mockImplementation(() => ({
		Log: ftpCmdMocks.log,
		Error: ftpCmdMocks.error,
	})),
}));

vi.mock("../../../../../cli-interaction", () => ({
	CliInteraction: vi.fn().mockImplementation(() => ({
		Confirm: ftpCmdMocks.confirm,
	})),
}));

vi.mock("../../../../../cli-executable-name", () => ({
	getCliExecutableName: () => "tiendanube",
}));

export { ftpCmdMocks } from "./theme-ftp-cmd-mock-impl";

function setTty(value: boolean): void {
	Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

/**
 * Default test context: non-interactive (no TTY), mirroring CI. Missing required
 * values error out and destructive confirms abort instead of prompting.
 */
export function forceNonInteractiveTestEnv(): void {
	setTty(false);
	process.env.CI = "";
}

/** Opt-in interactive context (TTY, not CI) for tests exercising prompts. */
export function forceInteractiveTestEnv(): void {
	setTty(true);
	process.env.CI = "";
}

export function resetFtpCmdMocks(): void {
	forceNonInteractiveTestEnv();
	ftpCmdMocks.isSet = false;
	ftpCmdMocks.tryLoadResult = { success: false, error: "bad" };
	ftpCmdMocks.save.mockClear();
	ftpCmdMocks.log.mockClear();
	ftpCmdMocks.error.mockClear();
	ftpCmdMocks.confirm.mockReset();
	ftpCmdMocks.confirm.mockResolvedValue(true);
	ftpCmdMocks.testFtp.mockReset();
	ftpCmdMocks.downloadAll.mockReset();
	ftpCmdMocks.syncAll.mockReset();
	ftpCmdMocks.upload.mockReset();
	ftpCmdMocks.delete.mockReset();
}
