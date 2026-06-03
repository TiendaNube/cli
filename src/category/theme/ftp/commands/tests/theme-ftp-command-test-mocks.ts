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

vi.mock("../../../../../nube-cli-logger", () => ({
	NubeCliLogger: vi.fn().mockImplementation(() => ({
		Log: ftpCmdMocks.log,
		Error: ftpCmdMocks.error,
	})),
}));

vi.mock("../../../../../nube-cli-interaction", () => ({
	NubeCliInteraction: vi.fn().mockImplementation(() => ({
		Confirm: ftpCmdMocks.confirm,
	})),
}));

vi.mock("../../../../../cli-executable-name", () => ({
	getCliExecutableName: () => "tiendanube",
}));

export { ftpCmdMocks } from "./theme-ftp-cmd-mock-impl";

export function resetFtpCmdMocks(): void {
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
