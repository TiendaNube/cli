import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { vi } from "vitest";
import { ThemeWorkspaceConfigManager } from "../../../theme/theme-workspace-config-manager";
import { AuthCredentialsStore } from "../../infra/auth-credentials-store";
import { authCmdMocks } from "./auth-cmd-mock-impl";

vi.mock("../../../../cli-logger", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	CliLogger: vi.fn().mockImplementation(function () {
		return {
			Log: authCmdMocks.log,
			Error: authCmdMocks.error,
			Warn: authCmdMocks.warn,
		};
	}),
}));

vi.mock("../../../../cli-interaction", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	CliInteraction: vi.fn().mockImplementation(function () {
		return {
			Confirm: authCmdMocks.confirm,
			Input: authCmdMocks.input,
			Password: authCmdMocks.password,
		};
	}),
}));

vi.mock("../../../../cli-executable-name", () => ({
	getCliExecutableName: () => authCmdMocks.bin,
}));

vi.mock("../../../theme/api/theme-api-client", async () => {
	const actual = await vi.importActual<
		typeof import("../../../theme/api/theme-api-client")
	>("../../../theme/api/theme-api-client");
	return {
		...actual,
		// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
		ThemeApiClient: vi.fn().mockImplementation(function () {
			return { listInstallations: authCmdMocks.listInstallations };
		}),
	};
});

vi.mock("../../../theme/ftp/theme-ftp-client", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 constructs mocks called with `new`, and an arrow implementation throws "is not a constructor"
	ThemeFtpClient: vi.fn().mockImplementation(function () {
		return { Test: authCmdMocks.ftpTest };
	}),
}));

vi.mock("../../../theme/api/open-system-browser", () => ({
	openSystemBrowser: (url: string) => authCmdMocks.openSystemBrowser(url),
}));

vi.mock("puppeteer", () => ({
	default: {
		launch: (...args: unknown[]) => authCmdMocks.puppeteerLaunch(...args),
	},
}));

export { authCmdMocks } from "./auth-cmd-mock-impl";

function setTty(value: boolean): void {
	Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

export function forceNonInteractiveTestEnv(): void {
	setTty(false);
	process.env.CI = "";
}

export function forceInteractiveTestEnv(): void {
	setTty(true);
	process.env.CI = "";
}

/** A temp HOME-like store and a temp `.nuvem`, both real files. */
export type AuthFixture = {
	dir: string;
	store: AuthCredentialsStore;
	workspace: ThemeWorkspaceConfigManager;
	workspaceFile: string;
	cleanup: () => void;
};

export function createAuthFixture(): AuthFixture {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-auth-cmd-"));
	const workspaceFile = path.join(dir, ".nuvem");
	return {
		dir,
		store: new AuthCredentialsStore(
			path.join(dir, "config", "credentials.json"),
		),
		workspace: new ThemeWorkspaceConfigManager(workspaceFile),
		workspaceFile,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}

/** Decoded `.nuvem`, or `null` when it was never written. */
export function readNuvem(file: string): Record<string, unknown> | null {
	if (!fs.existsSync(file)) {
		return null;
	}
	return JSON.parse(
		Buffer.from(fs.readFileSync(file, "utf8"), "base64").toString("utf8"),
	);
}

/** Root program with the global `-y` and a parent command named `parent`. */
export function programWith(
	parent: string,
	bind: (c: Command) => void,
): Command {
	const child = new Command(parent);
	bind(child);
	const program = new Command();
	program.option("-y, --yes", "Non-interactive: never prompt", false);
	program.addCommand(child);
	return program;
}

export async function parseWithTail(
	program: Command,
	tail: string[],
): Promise<void> {
	await program.parseAsync(tail, { from: "user" });
}

export function resetAuthCmdMocks(): void {
	forceNonInteractiveTestEnv();
	authCmdMocks.bin = "tiendanube";
	authCmdMocks.log.mockClear();
	authCmdMocks.error.mockClear();
	authCmdMocks.warn.mockClear();
	authCmdMocks.confirm.mockReset().mockResolvedValue(true);
	authCmdMocks.input.mockReset().mockResolvedValue("");
	authCmdMocks.password.mockReset().mockResolvedValue("");
	authCmdMocks.listInstallations.mockReset().mockResolvedValue([]);
	authCmdMocks.ftpTest
		.mockReset()
		.mockResolvedValue({ success: true, errorMessage: "" });
	authCmdMocks.openSystemBrowser.mockReset();
	authCmdMocks.puppeteerLaunch.mockReset();
}
