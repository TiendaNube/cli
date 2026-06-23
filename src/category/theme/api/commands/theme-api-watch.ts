import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import type { Command } from "commander";
import { Option } from "commander";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
	addThemePublishedOption,
} from "../theme-api-cli-options";
import { ThemeApiClient } from "../theme-api-client";
import { resolveThemeApiBaseUrl } from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { warnDeprecatedOption } from "../theme-api-deprecated-options";
import { ThemeApiError } from "../theme-api-error";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	getThemeFileFormat,
	readThemeFileContent,
} from "../theme-api-file-format";
import {
	canPushRelativePathWhenNotForked,
	isInstallationForked,
} from "../theme-api-fork-rules";
import {
	isPushUnsupported,
	themeUploadRelativePath,
} from "../theme-api-workspace-files";

/** Storefront URL with preview theme (matches theme preview query param). */
function buildStorefrontUrlWithThemeInstallationId(
	storeUrl: string,
	themeId: string,
): string {
	const trimmed = storeUrl.trim();
	try {
		const url = new URL(trimmed);
		url.searchParams.set("theme_installation_id", themeId);
		return url.href;
	} catch {
		const joiner = trimmed.includes("?") ? "&" : "?";
		return `${trimmed}${joiner}theme_installation_id=${encodeURIComponent(themeId)}`;
	}
}

type BrowserSetupResult = {
	browser: Browser;
	page: Page;
};

type WatchOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	/** When `--no-browser` is passed, Commander sets this to `false`. */
	browser?: boolean;
	v: boolean;
};

export class ThemeApiWatchCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

	private RunWithTrace = async (action: () => Promise<void>) => {
		const startDate = new Date();
		await action();
		const endDate = new Date();
		this.logger.Log(
			`-- Time taken: ${endDate.getTime() - startDate.getTime()}ms`,
		);
	};

	private async RunBrowserSetup(
		storePath: string,
		themeId: string,
	): Promise<BrowserSetupResult> {
		this.logger.Log("Setting up browser development session");
		const browser = await puppeteer.launch({
			headless: false,
			defaultViewport: null,
		});
		try {
			const pages = await browser.pages();
			const page = pages[0];
			page?.setDefaultTimeout(0);
			page?.setDefaultNavigationTimeout(0);
			const storefrontUrl = buildStorefrontUrlWithThemeInstallationId(
				storePath,
				themeId,
			);
			await page?.goto(storefrontUrl);

			this.logger.Log("Browser setup finished");
			return { browser: browser, page: page as Page } as BrowserSetupResult;
		} catch (err) {
			try {
				await browser.close();
			} catch {
				// ignore secondary close errors
			}
			throw err;
		}
	}

	private async Execute(
		options: WatchOptions,
		command: Command,
	): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const { config } = loaded;
		if (options.installationId !== undefined && options.themeId === undefined) {
			warnDeprecatedOption("--installation-id", "--theme-id");
		}
		const baseUrl = resolveThemeApiBaseUrl({
			configUrl: config.apiBaseUrl,
			cliUrl: options.apiUrl,
		});
		const extraHeaders = resolveExtraHeadersFromCli(
			options.header,
			this.logger,
		);
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: config.publicApiToken,
			storeId: config.storeId,
			verbose: options.v,
			extraHeaders,
		});

		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => client,
		});

		const installationMeta: unknown = await client.getInstallation(themeId);
		const forked = isInstallationForked(installationMeta);

		const storeUrl = config.storeUrl?.trim();
		const useBrowser = Boolean(storeUrl) && options.browser !== false;
		let storefrontPage: Page | undefined;
		if (useBrowser && storeUrl) {
			try {
				const browserSetup = await this.RunBrowserSetup(storeUrl, themeId);
				storefrontPage = browserSetup.page;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.logger.Error(
					`Browser setup failed: ${msg}. Continuing with API-only watch (no storefront reload).`,
				);
				storefrontPage = undefined;
			}
		} else if (!storeUrl) {
			const cli = getCliExecutableName();
			this.logger.Log(
				`API watch only (no browser). Run ${cli} theme authorize to save your storefront URL in .nuvem and enable auto-reload here.`,
			);
		} else {
			this.logger.Log(
				"Browser disabled (--no-browser): watching files and pushing via Public API only; no storefront reload.",
			);
		}

		let storefrontReloadIssueLogged = false;
		const reloadStorefront = async () => {
			if (!storefrontPage) return;
			if (storefrontPage.isClosed()) {
				if (!storefrontReloadIssueLogged) {
					storefrontReloadIssueLogged = true;
					this.logger.Error(
						"Storefront reload skipped: the browser page was closed. API sync continues.",
					);
				}
				return;
			}
			try {
				await storefrontPage.reload({ waitUntil: "domcontentloaded" });
			} catch (err) {
				if (!storefrontReloadIssueLogged) {
					storefrontReloadIssueLogged = true;
					const msg = err instanceof Error ? err.message : String(err);
					this.logger.Error(
						`Storefront reload failed: ${msg}. API sync continues.`,
					);
				}
			}
		};

		const pushOne = async (filePath: string, label: string) => {
			const themeRoot = path.resolve("./");
			const rel = themeUploadRelativePath(themeRoot, filePath);
			if (rel === null) {
				return;
			}
			const norm = rel.replace(/\\/g, "/");
			if (norm === "manifest.json") {
				return;
			}
			if (isPushUnsupported(norm)) {
				this.logger.Log(`Skipped: push is not yet supported for ${norm}`);
				return;
			}
			if (!forked && !canPushRelativePathWhenNotForked(norm)) {
				this.logger.Log(`Skipped (not forked): ${norm}`);
				return;
			}
			let stats: fs.Stats;
			try {
				stats = fs.statSync(filePath);
			} catch {
				return;
			}
			if (stats.size === 0) {
				return;
			}
			const format = getThemeFileFormat(norm);
			try {
				const content = readThemeFileContent(filePath, format);
				this.logger.Log(`${label}: ${norm}`);
				await client.upsertFile(themeId, norm, content, format);
				await reloadStorefront();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.logger.Error(`${label} failed ${norm}: ${msg}`);
			}
		};

		const deleteOne = async (filePath: string) => {
			const themeRoot = path.resolve("./");
			const rel = themeUploadRelativePath(themeRoot, filePath);
			if (rel === null) {
				return;
			}
			const norm = rel.replace(/\\/g, "/");
			if (norm === "manifest.json") {
				return;
			}
			if (isPushUnsupported(norm)) {
				return;
			}
			if (!forked && !canPushRelativePathWhenNotForked(norm)) {
				return;
			}
			try {
				this.logger.Log(`Deleting file: ${norm}`);
				await client.deleteFile(themeId, norm);
				this.logger.Log(`File deleted: ${norm}`);
				await reloadStorefront();
			} catch (err) {
				// File wasn't synced remotely — local delete has nothing to mirror.
				if (err instanceof ThemeApiError && err.status === 404) {
					return;
				}
				const msg = err instanceof Error ? err.message : String(err);
				this.logger.Error(`Delete failed ${norm}: ${msg}`);
			}
		};

		this.logger.Log("Monitoring for changes in theme files");
		const themeRoot = path.resolve("./");
		const watcher = chokidar.watch(themeRoot, {
			ignored: (filePath: string) =>
				themeUploadRelativePath(themeRoot, filePath) === null,
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 200,
				pollInterval: 100,
			},
		});
		watcher.on("ready", () => {
			this.logger.Log("Watcher ready (initial scan complete)");
		});
		watcher.on("error", (err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(`Watcher error: ${msg}`);
		});
		watcher.on("add", async (filePath) => {
			await this.RunWithTrace(async () => {
				await pushOne(filePath, "File added");
			});
		});
		watcher.on("change", async (filePath) => {
			await this.RunWithTrace(async () => {
				await pushOne(filePath, "File modified");
			});
		});
		watcher.on("unlink", async (filePath) => {
			await this.RunWithTrace(async () => {
				await deleteOne(filePath);
			});
		});
		this.logger.Log("Press Ctrl+C to stop");
	}

	Bind(command: Command): void {
		const watchCmd = command
			.command("watch")
			.description(
				"Start a local development process that watches for changes in the theme files and automatically uploads them to Nuvemshop/Tiendanube",
			)
			.option(
				"--theme-id <theme_id>",
				"Theme ID (defaults to last pulled theme)",
			)
			.addOption(
				new Option(
					"--installation-id <installation_id>",
					"Deprecated: use --theme-id",
				).hideHelp(),
			);
		addThemePublishedOption(watchCmd);
		addThemeApiTokenOption(watchCmd);
		addHiddenThemeApiUrlOption(watchCmd);
		addHiddenThemeApiHeaderOption(watchCmd);
		watchCmd
			.option(
				"--no-browser",
				"Do not open the store in a browser with automatic reloading, only watch for file changes",
			)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((options: WatchOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
