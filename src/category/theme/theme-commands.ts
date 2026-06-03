import type { Command } from "commander";
import { ThemeApiCommands } from "./api/theme-api";
import { ThemeFtpCommands } from "./ftp/theme-ftp";

export class ThemeCommands {
	Bind(program: Command): void {
		const theme = program
			.command("theme")
			.description(
				"Theme development commands (FTP or Public API sync with your Nuvemshop/Tiendanube store)",
			);
		new ThemeApiCommands().Bind(theme);
		new ThemeFtpCommands().Bind(theme);
	}
}
