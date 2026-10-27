import { vi } from "vitest";
import { themeApiCmdMocks } from "./theme-api-cmd-mock-impl";

const cliExecutableNameMocks = vi.hoisted(() => ({
	/** Override with `mockReturnValueOnce("nuvemshop")` in tests that depend on the invoked binary name. */
	getCliExecutableNameMock: vi.fn(() => "tiendanube"),
}));

export const getCliExecutableNameMock =
	cliExecutableNameMocks.getCliExecutableNameMock;

vi.mock("../../../theme-workspace-config-manager", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	ThemeWorkspaceConfigManager: vi.fn().mockImplementation(function () {
		return {
			TryLoadApiConfig: () => themeApiCmdMocks.tryLoadResult,
			mergeWorkspace: themeApiCmdMocks.mergeWorkspace,
			IsSet: () => themeApiCmdMocks.isSet,
			readWorkspace: () => themeApiCmdMocks.readWorkspaceReturn,
			readLastSync: () => themeApiCmdMocks.lastSync,
			recordLastSync: themeApiCmdMocks.recordLastSync,
		};
	}),
}));

// Keeps command specs off the real per-user credentials file: resolution reads
// `themeApiCmdMocks.identities`, and a legacy migration is a recorded no-op.
vi.mock("../../../../auth/infra/auth-credentials-store", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	AuthCredentialsStore: vi.fn().mockImplementation(function () {
		return {
			FilePath: "/tmp/credentials.json",
			list: () => themeApiCmdMocks.identities,
			get: (alias: string) =>
				themeApiCmdMocks.identities.find((entry) => entry.alias === alias),
			touch: themeApiCmdMocks.touchIdentity,
			defaultAlias: () => undefined,
		};
	}),
}));

vi.mock("../../../../auth/domain/auth-legacy-migration", () => ({
	migrateLegacyWorkspaceCredentials: themeApiCmdMocks.migrateLegacy,
}));

vi.mock("../../theme-api-client", async () => {
	const actual = await vi.importActual<typeof import("../../theme-api-client")>(
		"../../theme-api-client",
	);
	return {
		...actual,
		// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
		ThemeApiClient: vi.fn().mockImplementation(function () {
			return {
				listInstallations: themeApiCmdMocks.listInstallations,
				getInstallation: themeApiCmdMocks.getInstallation,
				createInstallation: themeApiCmdMocks.createInstallation,
				deleteInstallation: themeApiCmdMocks.deleteInstallation,
				publishInstallation: themeApiCmdMocks.publishInstallation,
				forkInstallation: themeApiCmdMocks.forkInstallation,
				cloneInstallation: themeApiCmdMocks.cloneInstallation,
				unforkInstallation: themeApiCmdMocks.unforkInstallation,
				updateInstallation: themeApiCmdMocks.updateInstallation,
				testUpdateInstallation: themeApiCmdMocks.testUpdateInstallation,
				getUpdateTargets: themeApiCmdMocks.getUpdateTargets,
				getFiles: themeApiCmdMocks.getFiles,
				getFile: themeApiCmdMocks.getFile,
				getFileHashes: themeApiCmdMocks.getFileHashes,
				upsertFile: themeApiCmdMocks.upsertFile,
				deleteFile: themeApiCmdMocks.deleteFile,
				batchUpdateFiles: themeApiCmdMocks.batchUpdateFiles,
				validateFiles: themeApiCmdMocks.validateFiles,
			};
		}),
	};
});

vi.mock("../../../../../cli-logger", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	CliLogger: vi.fn().mockImplementation(function () {
		return {
			Log: themeApiCmdMocks.log,
			Error: themeApiCmdMocks.error,
		};
	}),
}));

vi.mock("../../../../../cli-interaction", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	CliInteraction: vi.fn().mockImplementation(function () {
		return {
			Confirm: themeApiCmdMocks.confirm,
			Input: themeApiCmdMocks.input,
			Select: themeApiCmdMocks.select,
			Password: themeApiCmdMocks.password,
		};
	}),
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
	themeApiCmdMocks.identities = [];
	themeApiCmdMocks.touchIdentity.mockClear();
	themeApiCmdMocks.migrateLegacy.mockReset();
	themeApiCmdMocks.mergeWorkspace.mockClear();
	themeApiCmdMocks.recordLastSync.mockClear();
	themeApiCmdMocks.lastSync = undefined;
	themeApiCmdMocks.log.mockClear();
	themeApiCmdMocks.error.mockClear();
	themeApiCmdMocks.confirm.mockReset();
	themeApiCmdMocks.confirm.mockResolvedValue(true);
	themeApiCmdMocks.input.mockReset().mockResolvedValue("");
	themeApiCmdMocks.select.mockReset().mockResolvedValue("");
	themeApiCmdMocks.password.mockReset().mockResolvedValue("");
	themeApiCmdMocks.listInstallations.mockReset();
	themeApiCmdMocks.getInstallation.mockReset();
	themeApiCmdMocks.createInstallation.mockReset();
	themeApiCmdMocks.deleteInstallation.mockReset();
	themeApiCmdMocks.publishInstallation.mockReset();
	themeApiCmdMocks.forkInstallation.mockReset();
	themeApiCmdMocks.cloneInstallation.mockReset();
	themeApiCmdMocks.unforkInstallation.mockReset();
	themeApiCmdMocks.updateInstallation.mockReset();
	themeApiCmdMocks.testUpdateInstallation.mockReset();
	themeApiCmdMocks.getUpdateTargets.mockReset();
	themeApiCmdMocks.getFiles.mockReset();
	themeApiCmdMocks.getFile.mockReset();
	themeApiCmdMocks.getFileHashes.mockReset();
	themeApiCmdMocks.upsertFile.mockReset();
	themeApiCmdMocks.deleteFile.mockReset();
	themeApiCmdMocks.batchUpdateFiles.mockReset();
	// Default: the API accepts every file.
	themeApiCmdMocks.validateFiles.mockReset().mockResolvedValue([]);
	getCliExecutableNameMock.mockReset();
	getCliExecutableNameMock.mockImplementation(() => "tiendanube");
}
