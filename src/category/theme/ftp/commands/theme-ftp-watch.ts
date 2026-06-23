import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import type { Command } from "commander";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliLogger } from "../../../../cli-logger";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";
import { ThemeFtpTools } from "../theme-ftp-tools";

type BrowserSetupResult = {
	browser: Browser;
	page: Page;
};

export class ThemeFtpWatchCommand {
	private logger = new CliLogger();
	private configurationManager = new ThemeFtpConfigManager();

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
	): Promise<BrowserSetupResult> {
		this.logger.Log("Setting up browser development session");
		const browser = await puppeteer.launch({
			headless: false,
			defaultViewport: null,
		});
		const pages = await browser.pages();
		const page = pages[0];
		page?.setDefaultTimeout(0);
		page?.setDefaultNavigationTimeout(0);
		await page?.goto(`${storePath}/admin`);

		this.logger.Log("Please login in the admin to allow automated refresh");
		await page?.waitForFunction(() =>
			window.location.href.includes("dashboard"),
		);
		await page?.goto(storePath);

		this.logger.Log("Browser setup finished");
		return { browser: browser, page: page as Page } as BrowserSetupResult;
	}

	private async Execute(options: {
		v: boolean;
		browser: boolean;
	}): Promise<void> {
		if (!this.configurationManager.IsSet()) {
			throw new CliError(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
		}

		const loaded = this.configurationManager.TryLoad();
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);

		const storePath = loaded.config.storeUrl;
		const useBrowser = options.browser !== false;
		let storefrontPage: Page | undefined;
		if (useBrowser) {
			const browserSetup = await this.RunBrowserSetup(storePath);
			storefrontPage = browserSetup.page;
		} else {
			this.logger.Log(
				"Browser disabled (--no-browser): watching files and uploading to FTP only.",
			);
		}

		let storefrontReloadIssueLogged = false;
		const reloadStorefront = async () => {
			if (!storefrontPage) return;
			if (storefrontPage.isClosed()) {
				if (!storefrontReloadIssueLogged) {
					storefrontReloadIssueLogged = true;
					this.logger.Error(
						"Storefront reload skipped: the browser page was closed. FTP sync continues; pass --no-browser if you do not need reload.",
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
						`Storefront reload failed: ${msg}. FTP sync continues; pass --no-browser if you do not need reload.`,
					);
				}
			}
		};

		this.logger.Log("Monitoring for changes in theme files");
		const themeRoot = path.resolve("./");
		// Tracks the mtime that pullRemoteMtimeToLocal applied to each file after
		// upload. The next change event whose stat matches is the echo from our
		// own utimes call — skip it to avoid an infinite upload loop.
		const lastSyncedMtimeMs = new Map<string, number>();
		const recordSyncedMtime = async (filePath: string): Promise<void> => {
			try {
				const stats = await fs.promises.stat(filePath);
				lastSyncedMtimeMs.set(filePath, stats.mtimeMs);
			} catch {
				lastSyncedMtimeMs.delete(filePath);
			}
		};
		const isEchoFromOurUtimes = async (filePath: string): Promise<boolean> => {
			const recorded = lastSyncedMtimeMs.get(filePath);
			if (recorded === undefined) return false;
			try {
				const stats = await fs.promises.stat(filePath);
				return stats.mtimeMs === recorded;
			} catch {
				return false;
			}
		};
		const watcher = chokidar.watch(themeRoot, {
			ignored: (filePath: string) =>
				ThemeFtpTools.themeUploadRelativePath(themeRoot, filePath) === null,
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
				this.logger.Log(`File added: ${filePath}`);
				await client.Upload(filePath);
				await recordSyncedMtime(filePath);
				await reloadStorefront();
			});
		});
		watcher.on("change", async (filePath) => {
			if (await isEchoFromOurUtimes(filePath)) return;
			await this.RunWithTrace(async () => {
				this.logger.Log(`File modified: ${filePath}`);
				await client.Upload(filePath);
				await recordSyncedMtime(filePath);
				await reloadStorefront();
			});
		});
		watcher.on("unlink", async (filePath) => {
			await this.RunWithTrace(async () => {
				this.logger.Log(`File deleted: ${filePath}`);
				await client.Delete(filePath);
				await reloadStorefront();
			});
		});
		this.logger.Log("Press Ctrl+C to stop");
	}

	Bind(command: Command): void {
		command
			.command("watch")
			.description(
				"Start a local development process that watches for changes in the theme files and automatically uploads them to the server",
			)
			.option(
				"--no-browser",
				"Do not open the store in a browser with automatic reloading, only watch for file changes",
			)
			.option("-v", "Enable verbose logging", false)
			.action(
				runAction((options: { v: boolean; browser: boolean }) =>
					this.Execute(options),
				),
			);
	}
}
