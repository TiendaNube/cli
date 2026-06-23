import { vi } from "vitest";
import { themeApiCmdMocks } from "./theme-api-cmd-mock-impl";

const cliExecutableNameMocks = vi.hoisted(() => ({
	/** Override with `mockReturnValueOnce("nuvemshop")` in tests that depend on the invoked binary name. */
	getCliExecutableNameMock: vi.fn(() => "tiendanube"),
}));

export const getCliExecutableNameMock =
	cliExecutableNameMocks.getCliExecutableNameMock;

vi.mock("../../../theme-workspace-config-manager", () => ({
	ThemeWorkspaceConfigManager: vi.fn().mockImplementation(() => ({
		TryLoadApiConfig: () => themeApiCmdMocks.tryLoadResult,
		mergeWorkspace: themeApiCmdMocks.mergeWorkspace,
		IsSet: () => themeApiCmdMocks.isSet,
		readWorkspace: () => themeApiCmdMocks.readWorkspaceReturn,
	})),
}));

vi.mock("../../theme-api-client", async () => {
	const actual = await vi.importActual<typeof import("../../theme-api-client")>(
		"../../theme-api-client",
	);
	return {
		...actual,
		ThemeApiClient: vi.fn().mockImplementation(() => ({
			listInstallations: themeApiCmdMocks.listInstallations,
			getInstallation: themeApiCmdMocks.getInstallation,
			createInstallation: themeApiCmdMocks.createInstallation,
			deleteInstallation: themeApiCmdMocks.deleteInstallation,
			publishInstallation: themeApiCmdMocks.publishInstallation,
			forkInstallation: themeApiCmdMocks.forkInstallation,
			cloneInstallation: themeApiCmdMocks.cloneInstallation,
			getFiles: themeApiCmdMocks.getFiles,
			getFileHashes: themeApiCmdMocks.getFileHashes,
			upsertFile: themeApiCmdMocks.upsertFile,
			deleteFile: themeApiCmdMocks.deleteFile,
			batchUpdateFiles: themeApiCmdMocks.batchUpdateFiles,
		})),
	};
});

vi.mock("../../../../../cli-logger", () => ({
	CliLogger: vi.fn().mockImplementation(() => ({
		Log: themeApiCmdMocks.log,
		Error: themeApiCmdMocks.error,
	})),
}));

vi.mock("../../../../../cli-interaction", () => ({
	CliInteraction: vi.fn().mockImplementation(() => ({
		Confirm: themeApiCmdMocks.confirm,
		Input: themeApiCmdMocks.input,
		Password: themeApiCmdMocks.password,
	})),
}));

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

vi.mock("../../../../../cli-executable-name", () => ({
	getCliExecutableName: () => cliExecutableNameMocks.getCliExecutableNameMock(),
}));

export { themeApiCmdMocks } from "./theme-api-cmd-mock-impl";

export function resetThemeApiCmdMocks(): void {
	forceNonInteractiveTestEnv();
	themeApiCmdMocks.tryLoadResult = { success: false, error: "no config" };
	themeApiCmdMocks.isSet = false;
	themeApiCmdMocks.readWorkspaceReturn = {};
	themeApiCmdMocks.mergeWorkspace.mockClear();
	themeApiCmdMocks.log.mockClear();
	themeApiCmdMocks.error.mockClear();
	themeApiCmdMocks.confirm.mockReset();
	themeApiCmdMocks.confirm.mockResolvedValue(true);
	themeApiCmdMocks.input.mockReset().mockResolvedValue("");
	themeApiCmdMocks.password.mockReset().mockResolvedValue("");
	themeApiCmdMocks.listInstallations.mockReset();
	themeApiCmdMocks.getInstallation.mockReset();
	themeApiCmdMocks.createInstallation.mockReset();
	themeApiCmdMocks.deleteInstallation.mockReset();
	themeApiCmdMocks.publishInstallation.mockReset();
	themeApiCmdMocks.forkInstallation.mockReset();
	themeApiCmdMocks.cloneInstallation.mockReset();
	themeApiCmdMocks.getFiles.mockReset();
	themeApiCmdMocks.getFileHashes.mockReset();
	themeApiCmdMocks.upsertFile.mockReset();
	themeApiCmdMocks.deleteFile.mockReset();
	themeApiCmdMocks.batchUpdateFiles.mockReset();
	getCliExecutableNameMock.mockReset();
	getCliExecutableNameMock.mockImplementation(() => "tiendanube");
}
