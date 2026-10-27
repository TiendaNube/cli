import "./auth-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthFtpCommand } from "../auth-ftp";
import {
	type AuthFixture,
	authCmdMocks,
	createAuthFixture,
	forceInteractiveTestEnv,
	parseWithTail,
	programWith,
	readNuvem,
	resetAuthCmdMocks,
} from "./auth-command-test-mocks";

const FLAGS = [
	"--ftp-server",
	"ftp.example.com",
	"--ftp-username",
	"user",
	"--ftp-password",
	"secret",
	"--store-url",
	"https://classic.lojavirtualnuvem.com.br",
];

describe("AuthFtpCommand", () => {
	let fixture: AuthFixture;

	beforeEach(() => {
		resetAuthCmdMocks();
		fixture = createAuthFixture();
	});

	afterEach(() => {
		fixture.cleanup();
	});

	function program(binding?: { name: string; deprecatedFor: string }) {
		return programWith("auth", (c) => {
			new AuthFtpCommand(fixture.store, fixture.workspace).Bind(c, binding);
		});
	}

	it("tests the connection, stores tokens.ftp and leaves no password in the folder", async () => {
		await parseWithTail(program(), ["auth", "ftp", ...FLAGS]);

		expect(authCmdMocks.ftpTest).toHaveBeenCalledTimes(1);
		expect(fixture.store.get("classic")).toMatchObject({
			type: "store",
			data: { storeUrl: "https://classic.lojavirtualnuvem.com.br" },
			tokens: {
				ftp: {
					server: "ftp.example.com",
					username: "user",
					password: "secret",
				},
			},
		});
		expect(fixture.store.get("classic")?.data.storeId).toBeUndefined();
		expect(readNuvem(fixture.workspaceFile)).toEqual({
			alias: "classic",
		});
	});

	it("stores nothing when the connection test fails", async () => {
		authCmdMocks.ftpTest.mockResolvedValueOnce({
			success: false,
			errorMessage: "530 Login incorrect",
		});
		await parseWithTail(program(), ["auth", "ftp", ...FLAGS]);
		expect(authCmdMocks.error).toHaveBeenCalledWith(
			expect.stringContaining(
				"Could not connect to the FTP server with these details (530 Login incorrect). Nothing was saved.",
			),
		);
		expect(fixture.store.list()).toEqual([]);
		expect(readNuvem(fixture.workspaceFile)).toBeNull();
	});

	it("joins the entry of the same storefront host instead of creating a second one", async () => {
		fixture.store.put({
			alias: "shop",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: {
				storeId: "1",
				storeUrl: "https://classic.lojavirtualnuvem.com.br",
			},
			tokens: { api: { accessToken: "api-token" } },
		});
		await parseWithTail(program(), ["auth", "ftp", ...FLAGS]);

		expect(fixture.store.list()).toHaveLength(1);
		expect(fixture.store.get("shop")?.tokens).toMatchObject({
			api: { accessToken: "api-token" },
			ftp: { password: "secret" },
		});
	});

	it("never merges into an alias that only shares the name, and asks nothing", async () => {
		fixture.store.put({
			alias: "classic",
			type: "store",
			createdAt: "2026-01-01T00:00:00.000Z",
			data: { storeId: "1", storeUrl: "https://classic.com.br" },
			tokens: { api: { accessToken: "api-token" } },
		});
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["auth", "ftp", ...FLAGS]);

		expect(authCmdMocks.confirm).not.toHaveBeenCalled();
		expect(authCmdMocks.input).not.toHaveBeenCalled();
		expect(fixture.store.get("classic")?.tokens.ftp).toBeUndefined();
		expect(fixture.store.get("classic-2")?.tokens.ftp?.password).toBe("secret");
	});

	it("prompts for missing values, the password masked, through the same validators", async () => {
		forceInteractiveTestEnv();
		authCmdMocks.input.mockResolvedValueOnce("ftp.example.com");
		authCmdMocks.input.mockResolvedValueOnce("user");
		authCmdMocks.password.mockResolvedValueOnce("secret");
		authCmdMocks.input.mockResolvedValueOnce(
			"https://classic.lojavirtualnuvem.com.br",
		);

		await parseWithTail(program(), ["auth", "ftp"]);

		expect(authCmdMocks.password).toHaveBeenCalledTimes(1);
		expect(fixture.store.get("classic")?.tokens.ftp?.password).toBe("secret");
	});

	it("fails before any connection when a required value is missing and nobody can be asked", async () => {
		await expect(
			parseWithTail(program(), [
				"auth",
				"ftp",
				"--ftp-server",
				"ftp.example.com",
			]),
		).rejects.toThrow(/required option/);
		expect(authCmdMocks.ftpTest).not.toHaveBeenCalled();
	});

	it("with --no-link stores the credential and writes no .nuvem", async () => {
		await parseWithTail(program(), ["auth", "ftp", ...FLAGS, "--no-link"]);

		expect(fixture.store.get("classic")?.tokens.ftp?.password).toBe("secret");
		expect(readNuvem(fixture.workspaceFile)).toBeNull();
	});

	it("refuses the old 'auth ftp login' spelling before any connection", async () => {
		const auth = program();
		auth.commands[0]?.commands[0]?.exitOverride().configureOutput({
			writeErr: () => {},
		});
		await expect(
			parseWithTail(auth, ["auth", "ftp", "login", ...FLAGS]),
		).rejects.toThrow(/too many arguments/);
		expect(authCmdMocks.ftpTest).not.toHaveBeenCalled();
		expect(fixture.store.list()).toEqual([]);
	});

	it("still works as the deprecated 'theme ftp setup', with a warning", async () => {
		const deprecated = programWith("theme", (theme) => {
			const ftp = theme.command("ftp");
			new AuthFtpCommand(fixture.store, fixture.workspace).Bind(ftp, {
				name: "setup",
				deprecatedFor: "auth ftp",
			});
		});
		await parseWithTail(deprecated, ["theme", "ftp", "setup", ...FLAGS]);
		expect(authCmdMocks.warn).toHaveBeenCalledWith(
			"Warning: 'theme ftp setup' is deprecated. Use 'auth ftp' instead.",
		);
		expect(fixture.store.get("classic")).toBeDefined();
	});
});
