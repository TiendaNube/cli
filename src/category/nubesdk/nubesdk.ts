import type { Command } from "commander";
import { NubesdkValidateSlotsCommand } from "./commands/nubesdk-validate-slots";

export class NubesdkCommands {
	Bind(command: Command): void {
		const nubesdk = command
			.command("nubesdk")
			.description("NubeSDK theme tooling");
		new NubesdkValidateSlotsCommand().Bind(nubesdk);
	}
}
