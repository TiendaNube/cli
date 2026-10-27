import { getCliExecutableName } from "../../../cli-executable-name";
import type { ThemeWorkspaceDocument } from "../../theme/theme-workspace-types";
import { withNextSteps } from "../cli/auth-messages";
import type { AuthCredentialsStore } from "../infra/auth-credentials-store";
import type { AuthTokenKind, Identity } from "./auth-credentials-types";

/** Both bin names read both spellings, like the `*_CLI_TELEMETRY_*` variables. */
export const ALIAS_ENV_VARS = [
	"NUVEMSHOP_CLI_ALIAS",
	"TIENDANUBE_CLI_ALIAS",
] as const;

/**
 * Where a run's credential came from, highest precedence first. `token` is
 * the ephemeral `--token` and only exists for the Public API commands.
 */
export type CredentialSource =
	| "token"
	| "alias-flag"
	| "env"
	| "workspace-alias"
	| "workspace-inline"
	| "default";

export type AliasSelection =
	| { ok: true; alias: string; source: "alias-flag" | "env" }
	| { ok: true; alias: undefined; source?: undefined }
	| { ok: false; error: string };

export function aliasFromEnvironment(
	env: Record<string, string | undefined> = process.env,
): { ok: true; alias: string | undefined } | { ok: false; error: string } {
	const values = ALIAS_ENV_VARS.map((name) => env[name]?.trim()).filter(
		(value): value is string => value !== undefined && value !== "",
	);
	const [first, ...rest] = values;
	if (rest.some((value) => value !== first)) {
		return {
			ok: false,
			error: withNextSteps(
				`${ALIAS_ENV_VARS.join(" and ")} point to different credentials (${values.map((value) => `"${value}"`).join(" and ")}).`,
				"Unset one of them, or pass --alias to choose for this run.",
			),
		};
	}
	return { ok: true, alias: first };
}

/**
 * The alias chosen for this run, before the folder is consulted: `--alias`,
 * then the environment variable.
 */
export function selectRunAlias(params: {
	flagAlias: string | undefined;
	env?: Record<string, string | undefined>;
}): AliasSelection {
	const fromFlag = params.flagAlias?.trim();
	if (fromFlag) {
		return { ok: true, alias: fromFlag, source: "alias-flag" };
	}
	const fromEnv = aliasFromEnvironment(params.env);
	if (!fromEnv.ok) {
		return fromEnv;
	}
	if (fromEnv.alias !== undefined) {
		return { ok: true, alias: fromEnv.alias, source: "env" };
	}
	return { ok: true, alias: undefined };
}

/**
 * The stored default, for a folder that names no credential of its own: not
 * linked, and holding no legacy credential inline. A folder that does hold
 * one belongs to a store, which may not be the default one.
 */
export function defaultAliasForFolder(
	store: AuthCredentialsStore,
	doc: ThemeWorkspaceDocument,
): string | undefined {
	const holdsInline =
		doc["theme-api"]?.publicApiToken !== undefined ||
		doc["theme-ftp"] !== undefined;
	return doc.alias === undefined && !holdsInline
		? store.defaultAlias()
		: undefined;
}

function loginCommandFor(kind: AuthTokenKind): string {
	return kind === "api" ? "auth login" : "auth ftp";
}

/** Looks the alias up and checks it holds the token this command family needs. */
export function identityForAlias(params: {
	store: AuthCredentialsStore;
	alias: string;
	source: "alias-flag" | "env" | "workspace-alias" | "default";
	kind: AuthTokenKind;
}): { ok: true; identity: Identity } | { ok: false; error: string } {
	const bin = getCliExecutableName();
	const identity = params.store.get(params.alias);
	if (identity === undefined) {
		if (params.source === "workspace-alias") {
			return {
				ok: false,
				error: withNextSteps(
					`This folder uses the credential "${params.alias}", but it is no longer stored on this machine.`,
					`Sign in again: ${bin} ${loginCommandFor(params.kind)} --alias ${params.alias}`,
					`Or use another stored credential: ${bin} auth link --alias <alias> (see ${bin} auth list)`,
				),
			};
		}
		if (params.source === "default") {
			return {
				ok: false,
				error: withNextSteps(
					`The default credential "${params.alias}" is no longer stored on this machine.`,
					`Choose another default: ${bin} auth default --alias <alias> (see ${bin} auth list)`,
				),
			};
		}
		const from =
			params.source === "env" ? " (set by the alias environment variable)" : "";
		return {
			ok: false,
			error: withNextSteps(
				`There is no stored credential called "${params.alias}"${from}.`,
				`See what is stored: ${bin} auth list`,
				`Or sign in and save it under that name: ${bin} ${loginCommandFor(params.kind)} --alias ${params.alias}`,
			),
		};
	}
	if (identity.tokens[params.kind] === undefined) {
		const other = params.kind === "api" ? "FTP" : "Public API";
		const needed = params.kind === "api" ? "Public API" : "FTP";
		const which =
			params.source === "default"
				? `The default credential "${params.alias}"`
				: `"${params.alias}"`;
		return {
			ok: false,
			error: withNextSteps(
				`${which} only has ${other} credentials, and this command needs ${needed} ones.`,
				`Add them to the same credential: ${bin} ${loginCommandFor(params.kind)} --alias ${params.alias}`,
			),
		};
	}
	return { ok: true, identity };
}

export function tokenWithAliasError(): string {
	return withNextSteps(
		"--token and --alias both name a credential; pass only one.",
		"For a one-off run that saves nothing, keep --token and drop --alias.",
		"To use a credential stored on this machine, keep --alias and drop --token.",
	);
}

/** Where the credential of a run came from, as the resolvers report it. */
export type RunCredential = { source: CredentialSource; alias?: string };

/**
 * The way out when the store (HTTP 401/403) or the FTP server (530) refuses
 * the credential a run used. "Refused", not "revoked": a 403 can also mean the
 * token lacks a permission.
 */
export function refusedCredentialStep(
	kind: AuthTokenKind,
	credential: RunCredential,
): string {
	const bin = getCliExecutableName();
	const login = `${bin} ${loginCommandFor(kind)}`;
	if (credential.source === "token") {
		return `The store refused the --token value. Get a fresh token by signing in again: ${login}`;
	}
	const refuser = kind === "api" ? "The store" : "The FTP server";
	if (credential.alias === undefined) {
		return `${refuser} refused the credential in this folder's .nuvem. Sign in again: ${login}`;
	}
	return `${refuser} refused the credential "${credential.alias}". Sign in again: ${login} --alias ${credential.alias}`;
}

export function unreadableWorkspaceError(detail: string): string {
	const bin = getCliExecutableName();
	return withNextSteps(
		`This folder's .nuvem file could not be read (${detail}).`,
		`Delete it and connect the folder again: ${bin} auth link --alias <alias>`,
	);
}

/** For commands that take `--alias` to manage a credential rather than to use one. */
export function unknownAliasError(alias: string): string {
	const bin = getCliExecutableName();
	return withNextSteps(
		`There is no stored credential called "${alias}".`,
		`See what is stored: ${bin} auth list`,
	);
}

export function noCredentialsError(kind: AuthTokenKind): string {
	const bin = getCliExecutableName();
	return withNextSteps(
		"This folder is not connected to a store yet.",
		`Use a credential already on this machine: ${bin} auth link --alias <alias> (see ${bin} auth list)`,
		`Or make one the default for every unlinked folder: ${bin} auth default --alias <alias>`,
		`Or sign in: ${bin} ${loginCommandFor(kind)}`,
	);
}
