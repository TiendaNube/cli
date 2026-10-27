import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import type { Command } from "commander";
import { Option } from "commander";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { authAliasOption } from "../../../auth/cli/auth-cli-options";
import { resolveThemeIdOrFail } from "../../theme-id-resolver";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { crossFamilyWatchRefusal } from "../../theme-workspace-sync-origin";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
	addThemePublishedOption,
} from "../theme-api-cli-options";
import { ThemeApiClient, type ThemeFileUpsert } from "../theme-api-client";
import {
	THEME_API_WATCH_DEBOUNCE_MS,
	resolveThemeApiBaseUrl,
} from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { warnDeprecatedOption } from "../theme-api-deprecated-options";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import { readThemeFileContent } from "../theme-api-file-format";
import {
	canPushRelativePathWhenNotForked,
	isInstallationForked,
} from "../theme-api-fork-rules";
import {
	ThemeApiWatchQueue,
	type ThemeWatchChange,
} from "../theme-api-watch-queue";
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
	alias?: string;
	apiUrl?: string;
	header?: string[];
	/** When `--no-browser` is passed, Commander sets this to `false`. */
	browser?: boolean;
	v: boolean;
};

export class ThemeApiWatchCommand {
	private logger = new CliLogger();
	private workspace = new ThemeWorkspaceConfigManager();

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
			alias: options.alias,
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
			credential: loaded,
			verbose: options.v,
			extraHeaders,
		});

		const themeId = await resolveThemeIdOrFail({
			cmd: command,
			options,
			config,
			getClient: () => client,
		});

		// Checked once at startup: a watch pushes on every save, so a cross-family
		// watch is the same hazard as a cross-family push, running continuously.
		// There is no --force here on purpose — for a long-lived loop, refusing with
		// an actionable message beats offering an escape hatch.
		if (!loaded.ephemeral) {
			const refusal = crossFamilyWatchRefusal({
				target: "api",
				lastSync: this.workspace.readLastSync(),
			});
			if (refusal !== null) {
				throw new CliError(refusal);
			}
		}

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
				`API watch only (no browser). Run ${cli} auth login to save your storefront URL and enable auto-reload here.`,
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

		const themeRoot = path.resolve("./");

		// Returns the path to sync, or null when watch must leave this file alone.
		const syncableRelativePath = (filePath: string): string | null => {
			const rel = themeUploadRelativePath(themeRoot, filePath);
			if (rel === null) {
				return null;
			}
			const norm = rel.replace(/\\/g, "/");
			if (norm === "manifest.json") {
				return null;
			}
			if (isPushUnsupported(norm)) {
				this.logger.Log(`Skipped: push is not yet supported for ${norm}`);
				return null;
			}
			if (!forked && !canPushRelativePathWhenNotForked(norm)) {
				this.logger.Log(`Skipped (not forked): ${norm}`);
				return null;
			}
			return norm;
		};

		// Content is read at send time, so a file saved several times in one window uploads its last version.
		const sendBatch = async (
			batch: ReadonlyMap<string, ThemeWatchChange>,
		): Promise<void> => {
			const upsert: ThemeFileUpsert[] = [];
			const toDelete: string[] = [];
			for (const [norm, change] of batch) {
				if (change === "delete") {
					toDelete.push(norm);
					continue;
				}
				const absolutePath = path.join(themeRoot, norm);
				let stats: fs.Stats;
				try {
					stats = fs.statSync(absolutePath);
				} catch {
					continue;
				}
				if (stats.size === 0) {
					continue;
				}
				try {
					upsert.push({
						path: norm,
						...readThemeFileContent(absolutePath, norm),
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.logger.Error(`Read failed ${norm}: ${msg}`);
				}
			}
			if (upsert.length === 0 && toDelete.length === 0) {
				return;
			}
			const startMs = Date.now();
			await client.batchUpdateFiles(themeId, upsert, toDelete);
			this.logger.Log(
				`Synced in ${Date.now() - startMs}ms — uploaded: ${upsert.length}, deleted: ${toDelete.length}`,
			);
			await reloadStorefront();
		};

		const queue = new ThemeApiWatchQueue({
			debounceMs: THEME_API_WATCH_DEBOUNCE_MS,
			sendBatch,
			onBatchError: (err, requeuedPathCount) => {
				const msg = err instanceof Error ? err.message : String(err);
				const retryNote =
					requeuedPathCount > 0
						? ` Retrying ${requeuedPathCount} file(s) with the next sync.`
						: " The batch was not fully synced; some changes may already be applied. Save the files again to retry.";
				this.logger.Error(`Sync failed: ${msg}.${retryNote}`);
			},
		});

		const enqueueEvent = (
			filePath: string,
			change: ThemeWatchChange,
			label: string,
		) => {
			const norm = syncableRelativePath(filePath);
			if (norm === null) {
				return;
			}
			this.logger.Log(`${label}: ${norm}`);
			queue.enqueue(norm, change);
		};

		this.logger.Log("Monitoring for changes in theme files");
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
		watcher.on("add", (filePath) => {
			enqueueEvent(filePath, "upsert", "File added");
		});
		watcher.on("change", (filePath) => {
			enqueueEvent(filePath, "upsert", "File modified");
		});
		watcher.on("unlink", (filePath) => {
			enqueueEvent(filePath, "delete", "File deleted");
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
		watchCmd.addOption(authAliasOption());
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
