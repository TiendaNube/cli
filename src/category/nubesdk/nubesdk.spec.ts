import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { NubesdkCommands } from "./nubesdk";

describe("NubesdkCommands", () => {
	it("binds nubesdk group with validate-slots", () => {
		const root = new Command();
		new NubesdkCommands().Bind(root);
		expect(root.commands.map((c) => c.name())).toContain("nubesdk");
		const nubesdk = root.commands.find((c) => c.name() === "nubesdk");
		expect(nubesdk).toBeDefined();
		expect(nubesdk?.commands.map((c) => c.name())).toContain("validate-slots");
	});
});
