import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { ThemeCommands } from "../theme-commands";

describe("Theme command tree", () => {
	it("binds theme with Public API theme subcommands and ftp group", () => {
		const root = new Command();
		new ThemeCommands().Bind(root);
		expect(root.commands.map((c) => c.name())).toContain("theme");
		const theme = root.commands.find((c) => c.name() === "theme");
		expect(theme).toBeDefined();
		const topNames = theme?.commands.map((c) => c.name()) ?? [];
		expect(topNames.sort()).toEqual(
			[
				"authorize",
				"clone",
				"create",
				"current",
				"delete",
				"fork",
				"ftp",
				"installation",
				"list",
				"preview",
				"publish",
				"pull",
				"push",
				"watch",
			].sort(),
		);

		const ftp = theme?.commands.find((c) => c.name() === "ftp");
		expect(ftp?.commands.map((c) => c.name()).sort()).toEqual(
			["pull", "push", "setup", "watch"].sort(),
		);
	});
});
