import type { Command } from "commander";
import puppeteer, { type Browser } from "puppeteer";
import { CliError, runAction } from "../../../cli-action";
import { getCliExecutableName } from "../../../cli-executable-name";
import { CliInteraction } from "../../../cli-interaction";
import { CliLogger } from "../../../cli-logger";
import { openSystemBrowser } from "../../theme/api/open-system-browser";
import {
	type CliAuthTokenPayload,
	decodeCliThemeAuthToken,
	fetchStorefrontUrlFromPublicApi,
} from "../../theme/api/theme-api-authorize-support";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addHiddenThemeAuthorizeUrlOption,
} from "../../theme/api/theme-api-cli-options";
import { ThemeApiClient } from "../../theme/api/theme-api-client";
import {
	DEFAULT_THEME_AUTHORIZE_URL,
	normalizeApiBaseUrl,
	resolveThemeApiBaseUrl,
} from "../../theme/api/theme-api-constants";
import { resolveExtraHeadersFromCli } from "../../theme/api/theme-api-extra-headers";
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

type LoginOptions = {
	alias?: string;
	link: boolean;
	authorizeUrl?: string;
	apiUrl?: string;
	header?: string[];
	token?: string;
	v?: boolean;
};

export type LoginBinding = {
	/** Defaults to `login`; `authorize` when bound as the deprecated `theme authorize`. */
	name?: string;
	/** Set on a deprecated spelling: the command to use instead. */
	deprecatedFor?: string;
};

function resolveAuthorizeUrl(raw: string | undefined): string {
	const fromCli = raw?.trim();
	return fromCli && fromCli.length > 0 ? fromCli : DEFAULT_THEME_AUTHORIZE_URL;
}

function validateBrowserUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return `URL must use http or https (got ${parsed.protocol}).`;
		}
		return null;
	} catch {
		return "Invalid authorize URL.";
	}
}

/** `nuvemshop` → Brazil; `tiendanube` (and any other basename) → Latin America — for auth UI locale on the authorize page. */
function authorizeUrlWithCliRegion(absoluteUrl: string): string {
	const parsed = new URL(absoluteUrl);
	const bin = getCliExecutableName().toLowerCase();
	const region = bin === "nuvemshop" ? "br" : "latam";
	parsed.searchParams.set("region", region);
	return parsed.toString();
}

export class AuthLoginCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();

	public constructor(
		private readonly store: AuthCredentialsStore = new AuthCredentialsStore(),
		private readonly workspace: ThemeWorkspaceConfigManager = new ThemeWorkspaceConfigManager(),
	) {}

	private async RunAuthorizeBrowserSetup(url: string): Promise<Browser | null> {
		let browser: Browser | undefined;
		try {
			browser = await puppeteer.launch({
				headless: false,
				defaultViewport: null,
			});
			const pages = await browser.pages();
			const page = pages[0];
			page?.setDefaultTimeout(0);
			page?.setDefaultNavigationTimeout(0);
			await page?.goto(url);
			return browser;
		} catch (err) {
			if (browser) {
				try {
					await browser.close();
				} catch {
					// ignore secondary close errors
				}
			}
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Log(
				`Puppeteer launch failed: ${msg}. Falling back to system browser.`,
			);
			return null;
		}
	}

	/** The pasted (or `--token`) payload, from the browser flow when no flag was given. */
	private async acquirePayload(
		options: LoginOptions,
	): Promise<CliAuthTokenPayload> {
		const tokenFromFlag = options.token?.trim();
		if (tokenFromFlag) {
			const decoded = decodeCliThemeAuthToken(tokenFromFlag);
			if (!decoded.ok) {
				throw new CliError(
					withNextSteps(
						`The --token value is not the token from the authorize page (${decoded.message})`,
						"Pass the whole text the page shows after you sign in, not only the access token.",
					),
				);
			}
			return decoded.value;
		}

		const resolved = resolveAuthorizeUrl(options.authorizeUrl);
		const validationError = validateBrowserUrl(resolved);
		if (validationError) {
			throw new CliError(validationError);
		}

		const url = authorizeUrlWithCliRegion(resolved);
		this.logger.Log(`Opening browser: ${url}`);

		const puppeteerBrowser = await this.RunAuthorizeBrowserSetup(url);
		if (!puppeteerBrowser) {
			openSystemBrowser(url);
		}
		this.logger.Log("After you sign in, copy the token from the page.");

		try {
			const pasted =
				(await this.interaction.Password("Paste your token:")) ?? "";
			const decoded = decodeCliThemeAuthToken(pasted);
			if (!decoded.ok) {
				const bin = getCliExecutableName();
				throw new CliError(
					pasted.trim() === ""
						? withNextSteps(
								"No token was pasted, so nothing was saved.",
								`Run ${bin} auth login again and paste the text the page shows after you sign in.`,
							)
						: withNextSteps(
								`That is not the token from the authorize page (${decoded.message})`,
								`Copy the whole text the page shows and run ${bin} auth login again.`,
							),
				);
			}
			return decoded.value;
		} finally {
			if (puppeteerBrowser) {
				try {
					await puppeteerBrowser.close();
				} catch {
					// ignore close errors — process exit will clean up
				}
			}
		}
	}

	/**
	 * The alias this store's credential goes under. A store already in
	 * `credentials.json` keeps its alias, so a re-login refreshes the token
	 * and asks nothing.
	 */
	private decideAlias(params: {
		requested: string | undefined;
		storeId: string;
		hosts: string[];
	}): string {
		const identities = this.store.list();
		const bin = getCliExecutableName();
		const sameStore = identities.find(
			(entry) => entry.data.storeId === params.storeId,
		);
		const takenByOtherStore = (alias: string): string | undefined => {
			const entry = identities.find((candidate) => candidate.alias === alias);
			return entry?.data.storeId !== undefined &&
				entry.data.storeId !== params.storeId
				? `The alias "${alias}" already belongs to another store (#${entry.data.storeId}). Choose another name.`
				: undefined;
		};

		if (params.requested !== undefined) {
			if (sameStore !== undefined && sameStore.alias !== params.requested) {
				throw new CliError(
					withNextSteps(
						`This store is already saved as "${sameStore.alias}", so it can't also be saved as "${params.requested}".`,
						`Refresh it under its current name: ${bin} auth login --alias ${sameStore.alias}`,
						`Or remove it first to save it under the new name: ${bin} auth remove --alias ${sameStore.alias}`,
					),
				);
			}
			const taken = takenByOtherStore(params.requested);
			if (taken !== undefined) {
				throw new CliError(
					withNextSteps(
						taken,
						"Pass another --alias, or leave it out to get one from the store's domain.",
					),
				);
			}
			return params.requested;
		}

		if (sameStore !== undefined) {
			this.logger.Log(
				`This store is already saved as "${sameStore.alias}"; refreshing its token.`,
			);
			return sameStore.alias;
		}

		// An FTP-only entry for the same storefront is the same store worked the
		// other way, so both credentials go under one alias.
		const ftpOnly = identities.find(
			(entry) =>
				entry.data.storeId === undefined &&
				params.hosts.includes(storefrontHost(entry.data.storeUrl) ?? ""),
		);
		if (ftpOnly !== undefined) {
			this.logger.Log(
				`Adding the Public API credential to "${ftpOnly.alias}" (${ftpOnly.data.storeUrl}).`,
			);
			return ftpOnly.alias;
		}

		const alias = uniqueAlias(deriveAliasFromHost(params.hosts[0]), identities);
		this.logger.Log(`Using alias "${alias}".`);
		return alias;
	}

	private async Execute(options: LoginOptions): Promise<void> {
		const requested = aliasFromFlag(options.alias);
		const payload = await this.acquirePayload(options);
		const { storeId, accessToken } = payload;

		const apiBaseUrl = resolveThemeApiBaseUrl({ cliUrl: options.apiUrl });
		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);

		this.logger.Log("Checking the token with the store…");
		const storeResult = await fetchStorefrontUrlFromPublicApi({
			apiBaseUrl,
			storeId,
			accessToken,
			extraHeaders,
		});
		if (!storeResult.ok) {
			const bin = getCliExecutableName();
			throw new CliError(
				storeResult.httpStatus !== undefined && storeResult.httpStatus < 500
					? withNextSteps(
							`The store did not accept this token (HTTP ${storeResult.httpStatus}). Nothing was saved.`,
							`Get a fresh token by signing in again: ${bin} auth login`,
						)
					: withNextSteps(
							`Could not reach the Nuvemshop/Tiendanube API to check the token (${storeResult.message}). Nothing was saved.`,
							"Check your connection and try again.",
						),
			);
		}

		this.logger.Log("Checking access to the store's themes…");
		try {
			await new ThemeApiClient({
				apiBaseUrl,
				publicApiToken: accessToken,
				storeId,
				verbose: options.v ?? false,
				extraHeaders,
			}).listInstallations();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new CliError(
				withNextSteps(
					`The token was accepted, but it could not list this store's themes (${msg}). Nothing was saved.`,
					`Sign in with a user that can manage the store's design: ${getCliExecutableName()} auth login`,
				),
			);
		}
		this.logger.Log("Token verified.");

		const hosts = [
			storefrontHost(storeResult.originalDomain),
			storefrontHost(storeResult.storeUrl),
		].filter((host): host is string => host !== undefined);
		const alias = this.decideAlias({
			requested,
			storeId,
			hosts,
		});

		const previous = this.store.get(alias);
		const customApiBaseUrl =
			options.apiUrl !== undefined && options.apiUrl.trim() !== ""
				? normalizeApiBaseUrl(options.apiUrl)
				: undefined;
		const identity: Identity = {
			alias,
			type: "store",
			createdAt: previous?.createdAt ?? new Date().toISOString(),
			...(previous?.lastUsedAt !== undefined
				? { lastUsedAt: previous.lastUsedAt }
				: {}),
			data: { ...previous?.data, storeId, storeUrl: storeResult.storeUrl },
			tokens: {
				...previous?.tokens,
				api: {
					accessToken,
					...(customApiBaseUrl !== undefined
						? { apiBaseUrl: customApiBaseUrl }
						: {}),
				},
			},
		};
		this.store.put(identity);

		if (options.link) {
			const doc = this.workspace.IsSet() ? this.workspace.readWorkspace() : {};
			this.workspace.linkAlias(alias, {
				keepThemeId:
					doc.alias === alias ||
					(doc.alias === undefined &&
						(doc["theme-api"]?.storeId === undefined ||
							doc["theme-api"].storeId === storeId)),
			});
		}

		logLoginOutcome({
			logger: this.logger,
			alias,
			filePath: this.store.FilePath,
			linked: options.link,
			nextCommands: "theme list, theme pull, theme push",
		});
	}

	Bind(parent: Command, binding: LoginBinding = {}): void {
		const loginCmd = parent
			.command(binding.name ?? "login")
			.description(
				binding.deprecatedFor !== undefined
					? `Deprecated: use '${binding.deprecatedFor}'.`
					: "Sign in to a store via browser and save the credential for every folder on this machine",
			)
			.option(
				"--alias <alias>",
				"Name for the stored credential (derived from the store domain when omitted)",
			)
			.option(
				"--token <token>",
				"Token obtained from the authorize page, instead of opening a browser",
			)
			.addOption(noLinkOption())
			.option("-v", "Verbose HTTP logging", false);
		addHiddenThemeAuthorizeUrlOption(loginCmd);
		addHiddenThemeApiUrlOption(loginCmd);
		addHiddenThemeApiHeaderOption(loginCmd);
		if (binding.deprecatedFor !== undefined) {
			const replacement = binding.deprecatedFor;
			loginCmd.hook("preAction", (_thisCommand, actionCommand) => {
				this.logger.Warn(
					`Warning: '${actionCommand.parent?.name()} ${actionCommand.name()}' is deprecated. Use '${replacement}' instead.`,
				);
			});
		}
		loginCmd
			.allowExcessArguments(true)
			.action(runAction((opts: LoginOptions) => this.Execute(opts)));
	}
}
