import type { Command } from "commander";
import { CliError, runAction } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import { CliLogger } from "../../../cli-logger";
import { addRequiredOption } from "../../../cli-required-option";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
} from "../../theme/api/theme-api-cli-options";
import { resolveExtraHeadersFromCli } from "../../theme/api/theme-api-extra-headers";
import { ThemeWorkspaceConfigManager } from "../../theme/theme-workspace-config-manager";
import { withNextSteps } from "../cli/auth-messages";
import { normalizeAlias, validateAliasFlag } from "../domain/auth-alias";
import { unknownAliasError } from "../domain/auth-credential-source";
import {
	AUTH_TOKEN_KINDS,
	type AuthTokenKind,
	type Identity,
} from "../domain/auth-credentials-types";
import { AuthCredentialsStore } from "../infra/auth-credentials-store";
import {
	type VerifyResult,
	verifyApiToken,
	verifyFtpToken,
} from "../infra/auth-verify";

type LinkOptions = {
	alias: string;
	apiUrl?: string;
	header?: string[];
	v: boolean;
};

const KIND_LABEL: Record<AuthTokenKind, string> = {
	api: "Public API",
	ftp: "FTP",
};

export class AuthLinkCommand {
	private logger = new CliLogger();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
		private readonly workspace: ThemeWorkspaceConfigManager = new ThemeWorkspaceConfigManager(),
	) {}

	private async verify(
		identity: Identity,
		kind: AuthTokenKind,
		options: LinkOptions,
	): Promise<VerifyResult> {
		const { api, ftp } = identity.tokens;
		if (kind === "api" && api !== undefined) {
			if (identity.data.storeId === undefined) {
				return { status: "rejected", message: "no store id" };
			}
			return verifyApiToken({
				token: api,
				storeId: identity.data.storeId,
				// Never the folder's own host: .nuvem may come from an untrusted
				// clone, and this request carries the stored token.
				apiUrl: options.apiUrl,
				extraHeaders: resolveExtraHeadersFromCli(options.header, this.logger),
			});
		}
		if (kind === "ftp" && ftp !== undefined) {
			return verifyFtpToken(ftp, options.v);
		}
		return { status: "rejected", message: "no credentials" };
	}

	/**
	 * A folder belongs to a store, not to a transport: it is linked to the
	 * alias whatever its credentials say. A credential that fails the check
	 * only warns, so an expired FTP password never blocks the Public API work.
	 */
	private async Execute(options: LinkOptions): Promise<void> {
		const bin = getCliExecutableName();
		const identity = this.store.get(options.alias);
		if (identity === undefined) {
			throw new CliError(unknownAliasError(options.alias));
		}
		const renew: Record<AuthTokenKind, string> = {
			api: `${bin} auth login --alias ${identity.alias}`,
			ftp: `${bin} auth ftp --alias ${identity.alias}`,
		};

		const held = AUTH_TOKEN_KINDS.filter(
			(kind) => identity.tokens[kind] !== undefined,
		);
		this.logger.Log(
			`Checking that the credentials of "${identity.alias}" still work…`,
		);
		const results = await Promise.all(
			held.map((kind) => this.verify(identity, kind, options)),
		);
		held.forEach((kind, index) => {
			const result = results[index];
			if (result === undefined || result.status === "ok") {
				return;
			}
			this.logger.Warn(
				result.status === "rejected"
					? withNextSteps(
							`Warning: the ${KIND_LABEL[kind]} credentials of "${identity.alias}" no longer work (${result.message}).`,
							`Sign in again to renew them: ${renew[kind]}`,
						)
					: withNextSteps(
							`Warning: could not check the ${KIND_LABEL[kind]} credentials of "${identity.alias}" right now (${result.message}).`,
							"The folder is linked anyway; check your connection before using them.",
						),
			);
		});

		const doc = this.workspace.IsSet() ? this.workspace.readWorkspace() : {};
		const sameStore =
			doc.alias === identity.alias ||
			(doc.alias === undefined &&
				(doc["theme-api"]?.storeId === undefined ||
					doc["theme-api"].storeId === identity.data.storeId));
		this.workspace.linkAlias(identity.alias, { keepThemeId: sameStore });
		this.logger.Log(
			`This folder now uses "${identity.alias}" (${identity.data.storeUrl ?? `store #${identity.data.storeId}`}).`,
		);
		for (const kind of AUTH_TOKEN_KINDS) {
			if (!held.includes(kind)) {
				this.logger.Log(
					`"${identity.alias}" has no ${KIND_LABEL[kind]} credentials; add them with ${renew[kind]}`,
				);
			}
		}
	}

	Bind(parent: Command): void {
		const linkCmd = parent
			.command("link")
			.description(
				"Point the current folder at a stored credential, without signing in again",
			);
		addRequiredOption(
			linkCmd,
			"--alias <alias>",
			"Alias of the stored credential (see 'auth list')",
			{
				validate: validateAliasFlag,
				normalize: normalizeAlias,
			},
		);
		linkCmd.option("-v", "Enable verbose logging", false);
		addHiddenThemeApiUrlOption(linkCmd);
		addHiddenThemeApiHeaderOption(linkCmd);
		linkCmd.action(runAction((opts: LinkOptions) => this.Execute(opts)));
	}
}
