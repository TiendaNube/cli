import type { Command } from "commander";
import { CliError, runAction } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import { CliInteraction } from "../../../cli-interaction";
import { CliLogger } from "../../../cli-logger";
import { addRequiredOption } from "../../../cli-required-option";
import { assertConfirmable, confirmOrAbort } from "../../../interactivity";
import { ThemeWorkspaceConfigManager } from "../../theme/theme-workspace-config-manager";
import { withNextSteps } from "../cli/auth-messages";
import { normalizeAlias, validateAliasFlag } from "../domain/auth-alias";
import { unknownAliasError } from "../domain/auth-credential-source";
import type { AuthTokenKind } from "../domain/auth-credentials-types";
import { AuthCredentialsStore } from "../infra/auth-credentials-store";

type RemoveOptions = {
	alias: string;
	api?: boolean;
	ftp?: boolean;
};

export class AuthRemoveCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
		private readonly workspace: ThemeWorkspaceConfigManager = new ThemeWorkspaceConfigManager(),
	) {}

	private folderAlias(): string | undefined {
		try {
			return this.workspace.IsSet()
				? this.workspace.readWorkspace().alias
				: undefined;
		} catch {
			return undefined;
		}
	}

	private async Execute(
		options: RemoveOptions,
		command: Command,
	): Promise<void> {
		assertConfirmable(command);
		const bin = getCliExecutableName();
		if (options.api && options.ftp) {
			throw new CliError(
				"Choose one: --api or --ftp removes only that part; leave both out to remove everything stored for the alias.",
			);
		}
		const kind: AuthTokenKind | undefined = options.api
			? "api"
			: options.ftp
				? "ftp"
				: undefined;

		const identity = this.store.get(options.alias);
		if (identity === undefined) {
			throw new CliError(unknownAliasError(options.alias));
		}
		if (kind !== undefined && identity.tokens[kind] === undefined) {
			throw new CliError(
				withNextSteps(
					`"${options.alias}" has no ${kind === "api" ? "Public API" : "FTP"} credentials, so there is nothing to remove.`,
					`See what it holds: ${bin} auth list`,
				),
			);
		}

		const what =
			kind === undefined
				? `the credential "${options.alias}" (${identity.data.storeUrl ?? `store #${identity.data.storeId}`})`
				: `the ${kind === "api" ? "Public API" : "FTP"} credentials of "${options.alias}"`;
		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			`Remove ${what} from this machine? Folders that use it will need to sign in again.`,
		);
		if (!confirmed) {
			this.logger.Log("Nothing removed.");
			return;
		}

		const wasDefault = this.store.defaultAlias() === options.alias;
		if (kind === undefined) {
			this.store.removeIdentity(options.alias);
			this.logger.Log(`Removed "${options.alias}".`);
		} else {
			const outcome = this.store.removeToken(options.alias, kind);
			this.logger.Log(
				outcome === "emptied"
					? `Removed "${options.alias}" entirely, since it held nothing else.`
					: `Removed the ${kind === "api" ? "Public API" : "FTP"} credentials of "${options.alias}".`,
			);
		}

		if (wasDefault && this.store.defaultAlias() === undefined) {
			this.logger.Warn(
				withNextSteps(
					`"${options.alias}" was the default credential, and there is no default now.`,
					`Choose another one: ${bin} auth default --alias <alias> (see ${bin} auth list)`,
				),
			);
		}

		if (this.folderAlias() === options.alias) {
			this.logger.Warn(
				withNextSteps(
					`This folder was using "${options.alias}" and is no longer connected to a store.`,
					`Use another stored credential: ${bin} auth link --alias <alias>`,
					`Or sign in again: ${bin} auth login`,
				),
			);
		}
	}

	Bind(parent: Command): void {
		const removeCmd = parent
			.command("remove")
			.description("Delete a stored credential from this machine");
		addRequiredOption(
			removeCmd,
			"--alias <alias>",
			"Alias of the stored credential (see 'auth list')",
			{
				validate: validateAliasFlag,
				normalize: normalizeAlias,
			},
		);
		removeCmd
			.option(
				"--api",
				"Remove only the Public API credential and keep the rest",
			)
			.option("--ftp", "Remove only the FTP credential and keep the rest")
			.action(
				runAction((opts: RemoveOptions, command: Command) =>
					this.Execute(opts, command),
				),
			);
	}
}
