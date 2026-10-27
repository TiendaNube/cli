import type { Command } from "commander";
import { AuthDefaultCommand } from "./commands/auth-default";
import { AuthFtpCommand } from "./commands/auth-ftp";
import { AuthLinkCommand } from "./commands/auth-link";
import { AuthListCommand } from "./commands/auth-list";
import { AuthLoginCommand } from "./commands/auth-login";
import { AuthRemoveCommand } from "./commands/auth-remove";

export class AuthCommands {
	Bind(program: Command): void {
		const auth = program
			.command("auth")
			.description(
				"Store credentials once per machine and reuse them in any folder",
			);
		new AuthLoginCommand().Bind(auth);
		new AuthFtpCommand().Bind(auth);
		new AuthLinkCommand().Bind(auth);
		new AuthDefaultCommand().Bind(auth);
		new AuthListCommand().Bind(auth);
		new AuthRemoveCommand().Bind(auth);
	}
}
