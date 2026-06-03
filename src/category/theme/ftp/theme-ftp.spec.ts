import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { ThemeFtpCommands } from "./theme-ftp";

describe("ThemeFtpCommands", () => {
	it("registers ftp group with setup, pull, push, watch on the theme command", () => {
		const root = new Command();
		const theme = root.command("theme").description("Theme");
		new ThemeFtpCommands().Bind(theme);
		expect(theme.commands.map((c) => c.name())).toContain("ftp");
		const ftp = theme.commands.find((c) => c.name() === "ftp");
		expect(ftp).toBeDefined();
		const ftpNames = ftp?.commands.map((c) => c.name()) ?? [];
		expect(ftpNames.sort()).toEqual(["pull", "push", "setup", "watch"].sort());
	});
});
