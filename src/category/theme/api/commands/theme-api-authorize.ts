import type { Command } from "commander";
import puppeteer, { type Browser } from "puppeteer";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { openSystemBrowser } from "../open-system-browser";
import {
	type CliAuthTokenPayload,
	decodeCliThemeAuthToken,
	fetchStorefrontUrlFromPublicApi,
} from "../theme-api-authorize-support";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addHiddenThemeAuthorizeUrlOption,
} from "../theme-api-cli-options";
import {
	DEFAULT_THEME_AUTHORIZE_URL,
	resolveThemeApiBaseUrl,
} from "../theme-api-constants";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import { executeThemeApiSetup } from "../theme-api-setup-execute";

type AuthorizeOptions = {
	authorizeUrl?: string;
	apiUrl?: string;
	header?: string[];
	token?: string;
	y?: boolean;
	v?: boolean;
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

export class ThemeApiAuthorizeCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();

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

	private async runSetupFromDecodedPayload(
		payload: CliAuthTokenPayload,
		options: AuthorizeOptions,
	): Promise<void> {
		const { storeId, accessToken } = payload;
		const apiBaseUrl = resolveThemeApiBaseUrl({ cliUrl: options.apiUrl });

		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);
		if (extraHeaders === null) {
			return;
		}

		this.logger.Log("Fetching store URL from Public API…");
		const storeResult = await fetchStorefrontUrlFromPublicApi({
			apiBaseUrl,
			storeId,
			accessToken,
			extraHeaders,
		});
		if (!storeResult.ok) {
			this.logger.Error(storeResult.message);
			return;
		}

		await executeThemeApiSetup({
			token: accessToken,
			storeId,
			storeUrl: storeResult.storeUrl,
			apiUrl: options.apiUrl,
			extraHeaders,
			skipConfirm: options.y ?? false,
			verbose: options.v ?? false,
		});
	}

	private async Execute(options: AuthorizeOptions): Promise<void> {
		const tokenFromFlag = options.token?.trim();
		if (tokenFromFlag) {
			const decoded = decodeCliThemeAuthToken(tokenFromFlag);
			if (!decoded.ok) {
				this.logger.Error(decoded.message);
				return;
			}
			await this.runSetupFromDecodedPayload(decoded.value, options);
			return;
		}

		const resolved = resolveAuthorizeUrl(options.authorizeUrl);
		const validationError = validateBrowserUrl(resolved);
		if (validationError) {
			this.logger.Error(validationError);
			return;
		}

		const url = authorizeUrlWithCliRegion(resolved);
		this.logger.Log(`Opening browser: ${url}`);

		const puppeteerBrowser = await this.RunAuthorizeBrowserSetup(url);
		if (!puppeteerBrowser) {
			openSystemBrowser(url);
		}
		this.logger.Log("After you sign in, copy the token from the page.");

		try {
			const pasted = await this.interaction.Input("Paste your token:");
			const decoded = decodeCliThemeAuthToken(pasted ?? "");
			if (!decoded.ok) {
				this.logger.Error(decoded.message);
				return;
			}

			await this.runSetupFromDecodedPayload(decoded.value, options);
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

	Bind(command: Command): void {
		const authorizeCmd = command
			.command("authorize")
			.description(
				"Sign in via browser to connect your store and enable theme operations",
			)
			.option("--token <token>", "Token obtained from the authorize page")
			.option(
				"-y",
				"Skips confirmation prompt when the current directory is not empty",
				false,
			)
			.option("-v", "Verbose HTTP logging", false);
		addHiddenThemeAuthorizeUrlOption(authorizeCmd);
		addHiddenThemeApiUrlOption(authorizeCmd);
		addHiddenThemeApiHeaderOption(authorizeCmd);
		authorizeCmd
			.allowExcessArguments(true)
			.action(async (opts: AuthorizeOptions) => {
				await this.Execute(opts);
			});
	}
}
