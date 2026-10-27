import type { ChalkInstance } from "chalk";
import type { Command } from "commander";
import { runAction } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import { CliLogger } from "../../../cli-logger";
import { writeJsonOutput } from "../../../json-output";
import { ThemeWorkspaceConfigManager } from "../../theme/theme-workspace-config-manager";
import type { ThemeWorkspaceDocument } from "../../theme/theme-workspace-types";
import {
	displayPath,
	formatCredentialTable,
	terminalChalk,
} from "../cli/auth-list-format";
import { storefrontHost } from "../domain/auth-alias";
import {
	type CredentialSource,
	aliasFromEnvironment,
} from "../domain/auth-credential-source";
import {
	AUTH_TOKEN_KINDS,
	type AuthTokenKind,
	type Identity,
} from "../domain/auth-credentials-types";
import { AuthCredentialsStore } from "../infra/auth-credentials-store";
import {
	type CredentialStatus,
	verifyApiToken,
	verifyFtpToken,
} from "../infra/auth-verify";

type ListOptions = {
	json: boolean;
	verify: boolean;
};

type FolderCredential = {
	alias?: string;
	source: Exclude<CredentialSource, "token" | "alias-flag"> | "none";
};

/**
 * Everything printed here is read from outside `tokens`, so no field of
 * this row can carry a secret: the token kinds are listed by name only.
 */
type ListRow = {
	alias: string;
	type: Identity["type"];
	tokens: AuthTokenKind[];
	storeId: string | null;
	storeUrl: string | null;
	host: string | null;
	createdAt: string;
	lastUsedAt: string | null;
	currentFolder: boolean;
	default: boolean;
	status?: Partial<Record<AuthTokenKind, CredentialStatus>>;
};

/** The footer line saying where this folder's credential comes from. */
function folderLine(folder: FolderCredential, chalk: ChalkInstance): string {
	const name = chalk.bold(`"${folder.alias}"`);
	switch (folder.source) {
		case "env":
			return `${chalk.cyan(">")} This folder uses ${name}, set by NUVEMSHOP_CLI_ALIAS / TIENDANUBE_CLI_ALIAS.`;
		case "workspace-alias":
			return `${chalk.cyan(">")} This folder uses ${name}, linked in its .nuvem file.`;
		case "workspace-inline":
			return "This folder still has an old-style credential inside .nuvem; the next theme command you run here moves it into this list.";
		case "default":
			return `${chalk.cyan(">")} This folder is not linked, so it uses ${name}, the default credential.`;
		case "none":
			return "This folder is not linked to any of these credentials.";
	}
}

export class AuthListCommand {
	private logger = new CliLogger();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
		private readonly workspace: ThemeWorkspaceConfigManager = new ThemeWorkspaceConfigManager(),
	) {}

	/** What a theme command run here, with no `--alias`, would authenticate with. */
	private folderCredential(defaultAlias: string | undefined): FolderCredential {
		const fromEnv = aliasFromEnvironment();
		if (fromEnv.ok && fromEnv.alias !== undefined) {
			return { alias: fromEnv.alias, source: "env" };
		}
		let doc: ThemeWorkspaceDocument = {};
		try {
			doc = this.workspace.IsSet() ? this.workspace.readWorkspace() : {};
		} catch {
			return { source: "none" };
		}
		if (doc.alias !== undefined) {
			return { alias: doc.alias, source: "workspace-alias" };
		}
		if (
			doc["theme-api"]?.publicApiToken !== undefined ||
			doc["theme-ftp"] !== undefined
		) {
			return { source: "workspace-inline" };
		}
		if (defaultAlias !== undefined) {
			return { alias: defaultAlias, source: "default" };
		}
		return { source: "none" };
	}

	private async verify(
		identity: Identity,
	): Promise<Partial<Record<AuthTokenKind, CredentialStatus>>> {
		const { api, ftp } = identity.tokens;
		const [apiResult, ftpResult] = await Promise.all([
			api !== undefined && identity.data.storeId !== undefined
				? verifyApiToken({ token: api, storeId: identity.data.storeId })
				: undefined,
			ftp !== undefined ? verifyFtpToken(ftp) : undefined,
		]);
		return {
			...(apiResult !== undefined ? { api: apiResult.status } : {}),
			...(ftpResult !== undefined ? { ftp: ftpResult.status } : {}),
		};
	}

	private async Execute(options: ListOptions): Promise<void> {
		const bin = getCliExecutableName();
		const identities = this.store.list();
		const defaultAlias = this.store.defaultAlias();
		const folder = this.folderCredential(defaultAlias);

		// Every credential is checked at once, so the wait is the slowest single
		// check rather than their sum.
		const statuses = options.verify
			? await Promise.all(identities.map((identity) => this.verify(identity)))
			: undefined;

		const rows: ListRow[] = identities.map((identity, index) => ({
			alias: identity.alias,
			type: identity.type,
			tokens: AUTH_TOKEN_KINDS.filter(
				(kind) => identity.tokens[kind] !== undefined,
			),
			storeId: identity.data.storeId ?? null,
			storeUrl: identity.data.storeUrl ?? null,
			host: storefrontHost(identity.data.storeUrl) ?? null,
			createdAt: identity.createdAt,
			lastUsedAt: identity.lastUsedAt ?? null,
			currentFolder: folder.alias === identity.alias,
			default: identity.alias === defaultAlias,
			...(statuses !== undefined ? { status: statuses[index] } : {}),
		}));

		if (options.json) {
			writeJsonOutput(
				`${JSON.stringify(
					{
						credentialsFile: this.store.FilePath,
						defaultAlias: defaultAlias ?? null,
						currentFolder: {
							alias: folder.alias ?? null,
							source: folder.source,
						},
						identities: rows,
					},
					null,
					2,
				)}\n`,
			);
			return;
		}

		if (rows.length === 0) {
			this.logger.Log(
				`No credentials stored on this machine yet.\n  → Sign in to a store: ${bin} auth login\n  → Or add FTP credentials for a classic theme: ${bin} auth ftp`,
			);
			if (folder.source === "workspace-inline") {
				this.logger.Log(
					"This folder still has an old-style credential inside .nuvem; the next theme command you run here moves it into the credential store.",
				);
			}
			return;
		}

		const chalk = terminalChalk();
		const lines = [
			formatCredentialTable(rows, { chalk, now: new Date() }),
			"",
			folderLine(folder, chalk),
			chalk.dim(`Stored in ${displayPath(this.store.FilePath)}`),
		];
		const renew = rows.flatMap((row) =>
			row.tokens
				.filter((kind) => row.status?.[kind] === "rejected")
				.map(
					(kind) =>
						`  ${bin} ${kind === "api" ? "auth login" : "auth ftp"} --alias ${row.alias}`,
				),
		);
		if (renew.length > 0) {
			lines.push(
				"",
				chalk.yellow("Some credentials no longer work. Sign in again with:"),
				...renew,
			);
		}
		process.stdout.write(`${lines.join("\n")}\n`);
	}

	Bind(parent: Command): void {
		parent
			.command("list")
			.description(
				"List stored credentials and check that each one still works",
			)
			.option("--json", "Use machine-readable JSON output", false)
			.option("--no-verify", "Skip checking each credential against its server")
			.action(runAction((opts: ListOptions) => this.Execute(opts)));
	}
}
