import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "./cli-action";
import type { CliInteraction } from "./cli-interaction";
import { confirmOrAbort, isInteractive, yesFlagSet } from "./interactivity";

const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

function setTty(value: boolean): void {
	Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

/** Minimal Command stub exposing only what these helpers read. */
function cmd(yes: boolean): Command {
	return { optsWithGlobals: () => ({ yes }) } as unknown as Command;
}

beforeEach(() => {
	vi.stubEnv("CI", "");
});

afterEach(() => {
	Object.defineProperty(process.stdin, "isTTY", {
		value: originalStdinIsTTY,
		configurable: true,
	});
	Object.defineProperty(process.stdout, "isTTY", {
		value: originalStdoutIsTTY,
		configurable: true,
	});
	vi.unstubAllEnvs();
});

describe("yesFlagSet", () => {
	it("is false without a command", () => {
		expect(yesFlagSet(undefined)).toBe(false);
	});

	it("reflects the merged global --yes flag", () => {
		expect(yesFlagSet(cmd(true))).toBe(true);
		expect(yesFlagSet(cmd(false))).toBe(false);
	});
});

describe("isInteractive", () => {
	it("is true on a TTY when not CI and --yes is absent", () => {
		setTty(true);
		expect(isInteractive(cmd(false))).toBe(true);
	});

	it("is false when --yes is set, regardless of TTY", () => {
		setTty(true);
		expect(isInteractive(cmd(true))).toBe(false);
	});

	it("is false when CI is truthy", () => {
		setTty(true);
		vi.stubEnv("CI", "true");
		expect(isInteractive(cmd(false))).toBe(false);
	});

	it("is false without a TTY", () => {
		setTty(false);
		expect(isInteractive(cmd(false))).toBe(false);
	});
});

describe("confirmOrAbort", () => {
	const makeInteraction = (answer: boolean) =>
		({
			Confirm: vi.fn().mockResolvedValue(answer),
		}) as unknown as CliInteraction & {
			Confirm: ReturnType<typeof vi.fn>;
		};

	it("returns true without prompting when --yes is set", async () => {
		const interaction = makeInteraction(false);
		setTty(true);
		await expect(confirmOrAbort(cmd(true), interaction, "ok?")).resolves.toBe(
			true,
		);
		expect(interaction.Confirm).not.toHaveBeenCalled();
	});

	it("aborts with CliError when non-interactive and --yes is absent", async () => {
		setTty(false);
		const interaction = makeInteraction(true);
		await expect(
			confirmOrAbort(cmd(false), interaction, "ok?"),
		).rejects.toThrow(CliError);
		expect(interaction.Confirm).not.toHaveBeenCalled();
	});

	it("prompts the user on a TTY and returns their answer", async () => {
		setTty(true);
		const interaction = makeInteraction(false);
		await expect(confirmOrAbort(cmd(false), interaction, "ok?")).resolves.toBe(
			false,
		);
		expect(interaction.Confirm).toHaveBeenCalledWith("ok?");
	});
});
