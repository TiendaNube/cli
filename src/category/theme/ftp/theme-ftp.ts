import type { Command } from "commander";
import { ThemeFtpPullCommand } from "./commands/theme-ftp-pull";
import { ThemeFtpPushCommand } from "./commands/theme-ftp-push";
import { ThemeFtpSetupCommand } from "./commands/theme-ftp-setup";
import { ThemeFtpWatchCommand } from "./commands/theme-ftp-watch";

export class ThemeFtpCommands {
	/** Register FTP subcommands on an existing `theme` command. */
	Bind(theme: Command): void {
		const ftp = theme
			.command("ftp")
			.description(
				"Legacy FTP theme sync (configure store FTP credentials and sync files)",
			);
		new ThemeFtpSetupCommand().Bind(ftp);
		new ThemeFtpPullCommand().Bind(ftp);
		new ThemeFtpPushCommand().Bind(ftp);
		new ThemeFtpWatchCommand().Bind(ftp);
	}
}
