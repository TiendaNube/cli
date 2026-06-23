import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolverMocks = vi.hoisted(() => ({
	promptForMissingValue: vi.fn(),
	isInteractive: vi.fn(),
}));

vi.mock("../../cli-required-option", () => ({
	promptForMissingValue: resolverMocks.promptForMissingValue,
}));

vi.mock("../../interactivity", () => ({
	isInteractive: resolverMocks.isInteractive,
}));

import { CliError } from "../../cli-action";
import { resolveThemeIdOrFail } from "./theme-id-resolver";

const cmd = {} as Command;
const config = { publicApiToken: "t", storeId: "1" };
const throwingClient = () => ({
	listInstallations: async () => {
		throw new Error("must not be called");
	},
});

describe("resolveThemeIdOrFail", () => {
	beforeEach(() => {
		resolverMocks.promptForMissingValue.mockReset();
		resolverMocks.isInteractive.mockReset().mockReturnValue(false);
	});

	it("returns the --theme-id flag without consulting the client", async () => {
		const id = await resolveThemeIdOrFail({
			cmd,
			options: { themeId: "7" },
			config,
			getClient: throwingClient,
		});
		expect(id).toBe("7");
	});

	it("falls back to the .nuvem config theme id", async () => {
		const id = await resolveThemeIdOrFail({
			cmd,
			options: {},
			config: { ...config, themeId: "9" },
			getClient: throwingClient,
		});
		expect(id).toBe("9");
	});

	it("resolves the productive theme id when --published is set", async () => {
		const id = await resolveThemeIdOrFail({
			cmd,
			options: { published: true },
			config,
			getClient: () => ({
				listInstallations: async () => ({
					installations: [{ id: 5, is_productive: true }],
				}),
			}),
		});
		expect(id).toBe("5");
		expect(resolverMocks.promptForMissingValue).not.toHaveBeenCalled();
	});

	it("prompts for the theme id when interactive and nothing else resolves", async () => {
		resolverMocks.isInteractive.mockReturnValue(true);
		resolverMocks.promptForMissingValue.mockResolvedValue("42");
		const id = await resolveThemeIdOrFail({
			cmd,
			options: {},
			config: undefined,
			getClient: throwingClient,
		});
		expect(id).toBe("42");
		expect(resolverMocks.promptForMissingValue).toHaveBeenCalledWith(
			"Enter theme-id:",
			expect.objectContaining({ validate: expect.any(Function) }),
			cmd,
		);
	});

	it("throws CliError mentioning --published when non-interactive and nothing resolves", async () => {
		await expect(
			resolveThemeIdOrFail({
				cmd,
				options: {},
				config: undefined,
				getClient: throwingClient,
			}),
		).rejects.toThrow(/use --published/);
		expect(resolverMocks.promptForMissingValue).not.toHaveBeenCalled();
	});

	it("omits the --published hint when the command does not support it", async () => {
		let thrown: unknown;
		try {
			await resolveThemeIdOrFail({
				cmd,
				options: {},
				config: undefined,
				getClient: throwingClient,
				supportsPublished: false,
			});
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(CliError);
		expect((thrown as CliError).message).not.toContain("--published");
	});
});
