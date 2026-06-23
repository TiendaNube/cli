import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interactionMocks = vi.hoisted(() => ({
	Input: vi.fn<(msg: string) => Promise<string>>(),
	Password: vi.fn<(msg: string) => Promise<string>>(),
}));

vi.mock("./cli-interaction", () => ({
	CliInteraction: vi.fn().mockImplementation(() => ({
		Input: interactionMocks.Input,
		Password: interactionMocks.Password,
		Confirm: vi.fn(),
	})),
}));

import {
	addRequiredOption,
	promptForMissingValue,
} from "./cli-required-option";

const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

function buildSetupLikeCommand(
	action: (opts: Record<string, unknown>) => void,
) {
	const cmd = new Command("setup");
	addRequiredOption(cmd, "--ftp-server <ftp_server>", "FTP server URL");
	addRequiredOption(cmd, "--ftp-username <ftp_username>", "FTP username");
	addRequiredOption(cmd, "--ftp-password <ftp_password>", "FTP password", {
		mask: true,
	});
	cmd.exitOverride().action((opts) => action(opts as Record<string, unknown>));
	return cmd;
}

describe("addRequiredOption", () => {
	beforeEach(() => {
		interactionMocks.Input.mockReset();
		interactionMocks.Password.mockReset();
		vi.stubEnv("CI", "");
	});

	afterEach(() => {
		process.stdin.isTTY = originalStdinIsTTY;
		process.stdout.isTTY = originalStdoutIsTTY;
		vi.unstubAllEnvs();
	});

	it("skips prompting when every required option is provided on the CLI", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		const action = vi.fn();
		const cmd = buildSetupLikeCommand(action);
		await cmd.parseAsync([
			"node",
			"setup",
			"--ftp-server",
			"s",
			"--ftp-username",
			"u",
			"--ftp-password",
			"p",
		]);
		expect(interactionMocks.Input).not.toHaveBeenCalled();
		expect(interactionMocks.Password).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({
				ftpServer: "s",
				ftpUsername: "u",
				ftpPassword: "p",
			}),
		);
	});

	it("prompts only for the missing options in declaration order", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("alice");
		interactionMocks.Password.mockResolvedValueOnce("s3cret");
		const action = vi.fn();
		const cmd = buildSetupLikeCommand(action);
		await cmd.parseAsync(["node", "setup", "--ftp-server", "host"]);
		expect(interactionMocks.Input).toHaveBeenCalledTimes(1);
		expect(interactionMocks.Input).toHaveBeenCalledWith(
			"Enter ftp-username:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(interactionMocks.Password).toHaveBeenCalledTimes(1);
		expect(interactionMocks.Password).toHaveBeenCalledWith(
			"Enter ftp-password:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({
				ftpServer: "host",
				ftpUsername: "alice",
				ftpPassword: "s3cret",
			}),
		);
	});

	it("uses Password prompt for masked options and Input for the rest", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("host");
		interactionMocks.Input.mockResolvedValueOnce("alice");
		interactionMocks.Password.mockResolvedValueOnce("s3cret");
		const action = vi.fn();
		const cmd = buildSetupLikeCommand(action);
		await cmd.parseAsync(["node", "setup"]);
		expect(interactionMocks.Input).toHaveBeenNthCalledWith(
			1,
			"Enter ftp-server:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(interactionMocks.Input).toHaveBeenNthCalledWith(
			2,
			"Enter ftp-username:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(interactionMocks.Password).toHaveBeenCalledWith(
			"Enter ftp-password:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({
				ftpServer: "host",
				ftpUsername: "alice",
				ftpPassword: "s3cret",
			}),
		);
	});

	it("passes a validator that rejects empty input (clack re-prompts inline)", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("real");
		const cmd = new Command("c").exitOverride();
		addRequiredOption(cmd, "--name <name>", "Name");
		cmd.action(() => {});
		await cmd.parseAsync(["node", "c"]);
		const validate = interactionMocks.Input.mock.calls[0]?.[1]?.validate as (
			v: string,
		) => string | undefined;
		expect(validate("")).toBeTruthy();
		expect(validate("  ")).toBeTruthy();
		expect(validate("ok")).toBeUndefined();
	});

	it("applies a custom validator and normalize to the option value", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("loja.com");
		const cmd = new Command("c").exitOverride();
		addRequiredOption(cmd, "--url <url>", "URL", {
			validate: (v) => (v.includes(".") ? undefined : "bad"),
			normalize: (v) => `https://${v}`,
		});
		const action = vi.fn();
		cmd.action((opts) => action(opts));
		await cmd.parseAsync(["node", "c"]);
		const validate = interactionMocks.Input.mock.calls[0]?.[1]?.validate as (
			v: string,
		) => string | undefined;
		expect(validate("nope")).toBe("bad");
		expect(validate("a.com")).toBeUndefined();
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://loja.com" }),
		);
	});

	it("throws CliError for a missing required option in non-TTY", async () => {
		process.stdin.isTTY = false;
		process.stdout.isTTY = false;
		const action = vi.fn();
		const cmd = buildSetupLikeCommand(action);
		await expect(cmd.parseAsync(["node", "setup"])).rejects.toThrow(
			"required option '--ftp-server <ftp_server>' not specified",
		);
		expect(action).not.toHaveBeenCalled();
	});

	it("throws CliError for a missing required option when --yes is set in a TTY", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		const action = vi.fn();
		const cmd = new Command("setup");
		addRequiredOption(cmd, "--ftp-server <ftp_server>", "FTP server URL");
		cmd.exitOverride().option("-y, --yes", "non-interactive").action(action);
		await expect(cmd.parseAsync(["node", "setup", "--yes"])).rejects.toThrow(
			"required option '--ftp-server <ftp_server>' not specified",
		);
		expect(interactionMocks.Input).not.toHaveBeenCalled();
		expect(action).not.toHaveBeenCalled();
	});
});

describe("promptForMissingValue", () => {
	beforeEach(() => {
		interactionMocks.Input.mockReset();
		interactionMocks.Password.mockReset();
		vi.stubEnv("CI", "");
	});

	afterEach(() => {
		process.stdin.isTTY = originalStdinIsTTY;
		process.stdout.isTTY = originalStdoutIsTTY;
		vi.unstubAllEnvs();
	});

	it("returns undefined and skips prompting outside a TTY", async () => {
		process.stdin.isTTY = false;
		process.stdout.isTTY = false;
		const value = await promptForMissingValue("Enter theme-id:");
		expect(value).toBeUndefined();
		expect(interactionMocks.Input).not.toHaveBeenCalled();
		expect(interactionMocks.Password).not.toHaveBeenCalled();
	});

	it("returns the input and forwards a validator in a TTY", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("12345");
		const value = await promptForMissingValue("Enter theme-id:");
		expect(value).toBe("12345");
		expect(interactionMocks.Input).toHaveBeenCalledWith(
			"Enter theme-id:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
	});

	it("uses the Password prompt when mask is enabled", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Password.mockResolvedValueOnce("s3cret");
		const value = await promptForMissingValue("Enter token:", { mask: true });
		expect(value).toBe("s3cret");
		expect(interactionMocks.Password).toHaveBeenCalledWith(
			"Enter token:",
			expect.objectContaining({ validate: expect.any(Function) }),
		);
		expect(interactionMocks.Input).not.toHaveBeenCalled();
	});

	it("applies normalize to the accepted value", async () => {
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		interactionMocks.Input.mockResolvedValueOnce("loja.com");
		const value = await promptForMissingValue("Enter store-url:", {
			normalize: (v) => `https://${v}`,
		});
		expect(value).toBe("https://loja.com");
	});
});
