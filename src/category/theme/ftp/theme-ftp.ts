import type { Command } from "commander";
import { AuthFtpCommand } from "../../auth/commands/auth-ftp";
import { ThemeFtpDiffCommand } from "./commands/theme-ftp-diff";
import { ThemeFtpPullCommand } from "./commands/theme-ftp-pull";
import { ThemeFtpPushCommand } from "./commands/theme-ftp-push";
import { ThemeFtpWatchCommand } from "./commands/theme-ftp-watch";

export class ThemeFtpCommands {
	/** Register FTP subcommands on an existing `theme` command. */
	Bind(theme: Command): void {
		const ftp = theme
			.command("ftp")
			.description("Legacy FTP theme sync for classic themes");
		new AuthFtpCommand().Bind(ftp, {
			name: "setup",
			deprecatedFor: "auth ftp",
		});
		new ThemeFtpPullCommand().Bind(ftp);
		new ThemeFtpDiffCommand().Bind(ftp);
		new ThemeFtpPushCommand().Bind(ftp);
		new ThemeFtpWatchCommand().Bind(ftp);
	}
}
