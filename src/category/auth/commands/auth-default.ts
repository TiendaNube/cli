import type { Command } from "commander";
import { CliError, runAction } from "../../../cli-action";
import { CliLogger } from "../../../cli-logger";
import { addRequiredOption } from "../../../cli-required-option";
import { normalizeAlias, validateAliasFlag } from "../domain/auth-alias";
import { unknownAliasError } from "../domain/auth-credential-source";
import { AuthCredentialsStore } from "../infra/auth-credentials-store";

type DefaultOptions = {
	alias: string;
};

export class AuthDefaultCommand {
	private logger = new CliLogger();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
	) {}

	private async Execute(options: DefaultOptions): Promise<void> {
		const identity = this.store.get(options.alias);
		if (identity === undefined) {
			throw new CliError(unknownAliasError(options.alias));
		}
		const store = identity.data.storeUrl ?? `store #${identity.data.storeId}`;
		if (this.store.defaultAlias() === identity.alias) {
			this.logger.Log(
				`"${identity.alias}" (${store}) is already the default credential.`,
			);
			return;
		}
		this.store.setDefault(identity.alias);
		this.logger.Log(
			`"${identity.alias}" (${store}) is now the default credential, used in any folder that is not linked to another one.`,
		);
	}

	Bind(parent: Command): void {
		const defaultCmd = parent
			.command("default")
			.description(
				"Choose the stored credential used in folders that are not linked to one",
			);
		addRequiredOption(
			defaultCmd,
			"--alias <alias>",
			"Alias of the stored credential (see 'auth list')",
			{
				validate: validateAliasFlag,
				normalize: normalizeAlias,
			},
		);
		defaultCmd.action(runAction((opts: DefaultOptions) => this.Execute(opts)));
	}
}
