import type { Command } from "commander";
import { CliError, runAction } from "../../../cli-action";
import { CliLogger } from "../../../cli-logger";
import { addRequiredOption } from "../../../cli-required-option";
import { ThemeFtpClient } from "../../theme/ftp/theme-ftp-client";
import {
	normalizeFtpServer,
	normalizeStoreUrl,
	validateStoreUrl,
} from "../../theme/ftp/theme-ftp-prompt-validators";
import { ThemeWorkspaceConfigManager } from "../../theme/theme-workspace-config-manager";
import { noLinkOption } from "../cli/auth-cli-options";
import { aliasFromFlag, logLoginOutcome } from "../cli/auth-login-support";
import { withNextSteps } from "../cli/auth-messages";
import {
	deriveAliasFromHost,
	storefrontHost,
	uniqueAlias,
} from "../domain/auth-alias";
import type { Identity } from "../domain/auth-credentials-types";
import { AuthCredentialsStore } from "../infra/auth-credentials-store";
import type { LoginBinding } from "./auth-login";

type FtpOptions = {
	alias?: string;
	link: boolean;
	ftpServer: string;
	ftpUsername: string;
	ftpPassword: string;
	storeUrl: string;
	v: boolean;
};

export class AuthFtpCommand {
	private logger = new CliLogger();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
		private readonly workspace: ThemeWorkspaceConfigManager = new ThemeWorkspaceConfigManager(),
	) {}

	/**
	 * The FTP flow never learns a store id, so the storefront host is the
	 * strongest identity it has: the same host joins the existing entry. A
	 * matching label on a different host may be another store, so it is never
	 * merged; the new entry gets a unique alias instead.
	 */
	private decideAlias(
		requested: string | undefined,
		host: string | undefined,
	): string {
		if (requested !== undefined) {
			return requested;
		}
		const identities = this.store.list();
		const sameHost =
			host !== undefined
				? identities.find(
						(entry) => storefrontHost(entry.data.storeUrl) === host,
					)
				: undefined;
		if (sameHost !== undefined) {
			this.logger.Log(
				`Adding the FTP credentials to "${sameHost.alias}" (${sameHost.data.storeUrl}).`,
			);
			return sameHost.alias;
		}
		const alias = uniqueAlias(deriveAliasFromHost(host), identities);
		this.logger.Log(`Using alias "${alias}".`);
		return alias;
	}

	private async Execute(options: FtpOptions): Promise<void> {
		const requested = aliasFromFlag(options.alias);

		this.logger.Log("Testing the FTP connection…");
		const ftpTestResult = await new ThemeFtpClient({
			ftpServer: options.ftpServer,
			ftpUsername: options.ftpUsername,
			ftpPassword: options.ftpPassword,
			verbose: options.v,
		}).Test();
		if (!ftpTestResult.success) {
			throw new CliError(
				withNextSteps(
					`Could not connect to the FTP server with these details (${ftpTestResult.errorMessage}). Nothing was saved.`,
					"Check the server, username and password in your store admin, under Design → code editor → FTP, then try again.",
				),
			);
		}
		this.logger.Log("FTP connection works.");

		const alias = this.decideAlias(requested, storefrontHost(options.storeUrl));
		const previous = this.store.get(alias);
		const identity: Identity = {
			alias,
			type: "store",
			createdAt: previous?.createdAt ?? new Date().toISOString(),
			...(previous?.lastUsedAt !== undefined
				? { lastUsedAt: previous.lastUsedAt }
				: {}),
			data: {
				...previous?.data,
				storeUrl: previous?.data.storeUrl ?? options.storeUrl,
			},
			tokens: {
				...previous?.tokens,
				ftp: {
					server: options.ftpServer,
					username: options.ftpUsername,
					password: options.ftpPassword,
				},
			},
		};
		this.store.put(identity);

		if (options.link) {
			const doc = this.workspace.IsSet() ? this.workspace.readWorkspace() : {};
			this.workspace.linkAlias(alias, {
				keepThemeId: doc.alias === undefined || doc.alias === alias,
			});
		}

		logLoginOutcome({
			logger: this.logger,
			alias,
			filePath: this.store.FilePath,
			linked: options.link,
			nextCommands: "theme ftp pull, theme ftp diff, theme ftp push",
		});
	}

	Bind(parent: Command, binding: LoginBinding = {}): void {
		const loginCmd = parent
			.command(binding.name ?? "ftp")
			.description(
				binding.deprecatedFor !== undefined
					? `Deprecated: use '${binding.deprecatedFor}'.`
					: "Save FTP credentials for a classic theme, tested before they are stored",
			);
		// Registered before the required options so the warning precedes their prompts.
		if (binding.deprecatedFor !== undefined) {
			const replacement = binding.deprecatedFor;
			loginCmd.hook("preAction", (_thisCommand, actionCommand) => {
				this.logger.Warn(
					`Warning: '${actionCommand.parent?.parent?.name()} ${actionCommand.parent?.name()} ${actionCommand.name()}' is deprecated. Use '${replacement}' instead.`,
				);
			});
		}
		addRequiredOption(loginCmd, "--ftp-server <ftp_server>", "FTP server URL", {
			normalize: normalizeFtpServer,
		});
		addRequiredOption(
			loginCmd,
			"--ftp-username <ftp_username>",
			"FTP username",
		);
		addRequiredOption(
			loginCmd,
			"--ftp-password <ftp_password>",
			"FTP password",
			{ mask: true },
		);
		addRequiredOption(
			loginCmd,
			"--store-url <store_url>",
			"Nuvemshop/Tiendanube store URL (e.g. https://your-store.lojavirtualnuvem.com.br)",
			{ validate: validateStoreUrl, normalize: normalizeStoreUrl },
		);
		loginCmd
			.option(
				"--alias <alias>",
				"Name for the stored credential (derived from the store URL when omitted)",
			)
			.addOption(noLinkOption())
			.option("-v", "Enable verbose logging", false)
			// Old `theme ftp setup` scripts may pass stray words; the new spelling
			// refuses them so a leftover `auth ftp login` does not run silently.
			.allowExcessArguments(binding.deprecatedFor !== undefined)
			.action(runAction((options: FtpOptions) => this.Execute(options)));
	}
}
