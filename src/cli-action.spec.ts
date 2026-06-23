import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMocks = vi.hoisted(() => ({
	Error: vi.fn(),
	Warn: vi.fn(),
	Log: vi.fn(),
}));

vi.mock("./cli-logger", () => ({
	CliLogger: vi.fn().mockImplementation(() => ({
		Error: loggerMocks.Error,
		Warn: loggerMocks.Warn,
		Log: loggerMocks.Log,
	})),
}));

import { CancelError, CliError, runAction } from "./cli-action";

describe("runAction", () => {
	beforeEach(() => {
		loggerMocks.Error.mockClear();
		loggerMocks.Warn.mockClear();
		process.exitCode = 0;
	});

	afterEach(() => {
		process.exitCode = 0;
	});

	it("runs the action, forwards args, and leaves exit code untouched on success", async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		await runAction(fn)("a", "b");
		expect(fn).toHaveBeenCalledWith("a", "b");
		expect(process.exitCode).toBe(0);
		expect(loggerMocks.Error).not.toHaveBeenCalled();
		expect(loggerMocks.Warn).not.toHaveBeenCalled();
	});

	it("sets exit code 1 and logs the message once on CliError", async () => {
		await runAction(() => {
			throw new CliError("boom");
		})();
		expect(process.exitCode).toBe(1);
		expect(loggerMocks.Error).toHaveBeenCalledOnce();
		expect(loggerMocks.Error).toHaveBeenCalledWith("boom");
	});

	it("sets exit code 1 and logs the message on a generic Error", async () => {
		await runAction(() => {
			throw new Error("kaboom");
		})();
		expect(process.exitCode).toBe(1);
		expect(loggerMocks.Error).toHaveBeenCalledWith("kaboom");
	});

	it("maps CancelError to exit code 130 with a warning, not an error", async () => {
		await runAction(() => {
			throw new CancelError();
		})();
		expect(process.exitCode).toBe(130);
		expect(loggerMocks.Warn).toHaveBeenCalledWith("Operation cancelled.");
		expect(loggerMocks.Error).not.toHaveBeenCalled();
	});

	it("maps an inquirer-style ExitPromptError to exit code 130", async () => {
		await runAction(() => {
			const err = new Error("aborted");
			err.name = "ExitPromptError";
			throw err;
		})();
		expect(process.exitCode).toBe(130);
		expect(loggerMocks.Warn).toHaveBeenCalled();
		expect(loggerMocks.Error).not.toHaveBeenCalled();
	});
});
