import { beforeEach, describe, expect, it, vi } from "vitest";

const clackMocks = vi.hoisted(() => ({
	text: vi.fn(),
	password: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(),
}));

vi.mock("@clack/prompts", () => clackMocks);

import { CancelError } from "./cli-action";
import { CliInteraction } from "./cli-interaction";

describe("CliInteraction", () => {
	const interaction = new CliInteraction();

	beforeEach(() => {
		clackMocks.text.mockReset();
		clackMocks.password.mockReset();
		clackMocks.confirm.mockReset();
		clackMocks.isCancel.mockReset().mockReturnValue(false);
	});

	it("Confirm returns the boolean answer", async () => {
		clackMocks.confirm.mockResolvedValue(true);
		await expect(interaction.Confirm("ok?")).resolves.toBe(true);
	});

	it("Input trims the answer", async () => {
		clackMocks.text.mockResolvedValue("  42  ");
		await expect(interaction.Input("id?")).resolves.toBe("42");
	});

	it("Password trims the answer", async () => {
		clackMocks.password.mockResolvedValue("  s3cret ");
		await expect(interaction.Password("pw?")).resolves.toBe("s3cret");
	});

	it("throws CancelError when the prompt is cancelled", async () => {
		const cancelSymbol = Symbol("cancel");
		clackMocks.text.mockResolvedValue(cancelSymbol);
		clackMocks.isCancel.mockReturnValue(true);
		await expect(interaction.Input("id?")).rejects.toThrow(CancelError);
	});

	it("forwards the validator to clack text/password", async () => {
		clackMocks.text.mockResolvedValue("x");
		clackMocks.password.mockResolvedValue("x");
		const validate = (v: string) => (v ? undefined : "required");

		await interaction.Input("id?", { validate });
		await interaction.Password("pw?", { validate });

		const textValidate = clackMocks.text.mock.calls[0]?.[0]?.validate;
		const passwordValidate = clackMocks.password.mock.calls[0]?.[0]?.validate;
		expect(textValidate).toBeTypeOf("function");
		expect(passwordValidate).toBeTypeOf("function");
		// The forwarded wrapper coerces undefined to "" before delegating.
		expect(textValidate("")).toBe("required");
		expect(textValidate(undefined)).toBe("required");
		expect(textValidate("ok")).toBeUndefined();
	});

	it("passes undefined validate to clack when none is given", async () => {
		clackMocks.text.mockResolvedValue("x");
		await interaction.Input("id?");
		expect(clackMocks.text.mock.calls[0]?.[0]?.validate).toBeUndefined();
	});
});
