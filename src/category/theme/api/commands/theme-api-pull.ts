import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { Option } from "commander";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { NubeCliInteraction } from "../../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../../theme-workspace-config-manager";
import { resolveThemeIdWithProductive } from "../../theme-workspace-types";
import {
	addHiddenThemeApiHeaderOption,
	addHiddenThemeApiUrlOption,
	addThemeApiTokenOption,
	addThemePublishedOption,
} from "../theme-api-cli-options";
import { ThemeApiClient, mapPool } from "../theme-api-client";
import {
	THEME_API_MAX_PARALLEL,
	THEME_API_PULL_PAGE_SIZE,
	resolveThemeApiBaseUrl,
} from "../theme-api-constants";
import { resolveApiCredentials } from "../theme-api-credentials";
import { warnDeprecatedOption } from "../theme-api-deprecated-options";
import { resolveExtraHeadersFromCli } from "../theme-api-extra-headers";
import {
	decodeRemoteFileContent,
	isPathInsideThemeRoot,
} from "../theme-api-file-format";
import {
	type RemoteThemeFile,
	parseGetFilesResponse,
} from "../theme-api-response-parsers";
import {
	cleanThemeWorkspace,
	isHiddenWorkspacePath,
	listThemeEntries,
} from "../theme-api-workspace-files";

type PullOptions = {
	themeId?: string;
	installationId?: string;
	published?: boolean;
	token?: string;
	apiUrl?: string;
	header?: string[];
	y: boolean;
	v: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ThemeApiPullCommand {
	private logger = new NubeCliLogger();
	private interaction = new NubeCliInteraction();
	private workspace = new ThemeWorkspaceConfigManager();

	private async Execute(options: PullOptions): Promise<void> {
		const loaded = resolveApiCredentials({
			token: options.token,
			workspace: this.workspace,
		});
		if (!loaded.success) {
			this.logger.Error(loaded.error);
			return;
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
		if (extraHeaders === null) {
			return;
		}
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: config.publicApiToken,
			storeId: config.storeId,
			verbose: options.v,
			extraHeaders,
		});

		const themeId = await resolveThemeIdWithProductive({
			options: {
				themeId: options.themeId ?? options.installationId,
				published: options.published,
			},
			config,
			getClient: () => client,
			logger: this.logger,
		});
		if (!themeId) {
			if (!options.published) {
				const cli = getCliExecutableName();
				this.logger.Error(
					`No theme id: pass --theme-id, use --published, or run ${cli} theme pull --theme-id <id> (saves to .nuvem).`,
				);
			}
			return;
		}

		const themeEntries = listThemeEntries(".");
		if (themeEntries.length > 0) {
			if (!options.y) {
				const confirm = await this.interaction.Confirm(
					`Current directory has ${themeEntries.length} non-hidden file(s)/folder(s) that will be deleted before pulling (hidden entries like .nuvem and .git are preserved). Do you want to continue?`,
				);
				if (!confirm) {
					return;
				}
			}
			cleanThemeWorkspace(".", themeEntries);
		}

		this.logger.Log("Downloading theme files from API…");
		const limit = THEME_API_PULL_PAGE_SIZE;
		const fetchPage = async (
			off: number,
		): Promise<ReturnType<typeof parseGetFilesResponse>> => {
			const raw = await client.getFiles(themeId, { offset: off, limit });
			return parseGetFilesResponse(raw);
		};

		let firstPage: ReturnType<typeof parseGetFilesResponse>;
		try {
			firstPage = await fetchPage(0);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.Error(msg);
			return;
		}
		const installation: unknown = firstPage.installation;
		const total = firstPage.total;
		const allFiles: RemoteThemeFile[] = [...firstPage.files];

		if (total !== null) {
			// Parallel path: `total` known, fan out the remaining offsets within
			// the shared API concurrency budget.
			const remainingOffsets: number[] = [];
			for (let off = limit; off < total; off += limit) {
				remainingOffsets.push(off);
			}
			if (remainingOffsets.length > 0) {
				let pages: ReturnType<typeof parseGetFilesResponse>[];
				try {
					pages = await mapPool(
						remainingOffsets,
						THEME_API_MAX_PARALLEL,
						(off) => fetchPage(off),
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.logger.Error(msg);
					return;
				}
				for (const page of pages) {
					allFiles.push(...page.files);
				}
			}
		} else if (firstPage.files.length >= limit) {
			// Sequential fallback: no `total`, iterate until a short page.
			let off = limit;
			for (;;) {
				let page: ReturnType<typeof parseGetFilesResponse>;
				try {
					page = await fetchPage(off);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.logger.Error(msg);
					return;
				}
				allFiles.push(...page.files);
				if (page.files.length < limit) {
					break;
				}
				off += limit;
			}
		}

		const cwd = path.resolve(".");
		for (const file of allFiles) {
			const rel = file.path.replace(/\\/g, "/");
			if (isHiddenWorkspacePath(rel)) {
				continue;
			}
			if (!isPathInsideThemeRoot(cwd, rel)) {
				this.logger.Error(`Refusing to write unsafe path: ${rel}`);
				return;
			}
			const dest = path.join(cwd, rel);
			const dir = path.dirname(dest);
			fs.mkdirSync(dir, { recursive: true });
			const payload = decodeRemoteFileContent(file.content, file.format);
			if (Buffer.isBuffer(payload)) {
				fs.writeFileSync(dest, payload);
			} else {
				fs.writeFileSync(dest, payload, "utf8");
			}
			this.logger.Log(`  ${rel}`);
		}

		const inst = installation;
		let manifest: Record<string, unknown> = {
			theme_id: themeId,
		};
		if (isRecord(inst)) {
			manifest = {
				theme: inst.theme ?? null,
				theme_version: inst.theme_version ?? null,
				forked: inst.forked ?? false,
				revision_token: inst.revision_token ?? null,
				theme_id: inst.id ?? themeId,
			};
		}
		const persistedThemeId =
			typeof manifest.theme_id === "string" && manifest.theme_id.trim() !== ""
				? manifest.theme_id.trim()
				: themeId;
		if (!loaded.ephemeral) {
			this.workspace.mergeWorkspace({
				"theme-api": {
					...config,
					themeId: persistedThemeId,
				},
			});
		}
		const manifestPath = path.join(cwd, "manifest.json");
		fs.writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		this.logger.Log("  manifest.json");
		this.logger.Log("Download completed.");
	}

	Bind(command: Command): void {
		const pullCmd = command
			.command("pull")
			.description(
				"Download theme files from Nuvemshop/Tiendanube to the current directory",
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
		addThemePublishedOption(pullCmd);
		addThemeApiTokenOption(pullCmd);
		addHiddenThemeApiUrlOption(pullCmd);
		addHiddenThemeApiHeaderOption(pullCmd);
		pullCmd
			.option("-y", "Skip confirmation prompt", false)
			.option("-v", "Enable verbose logging", false)
			.action(async (opts: PullOptions) => {
				await this.Execute(opts);
			});
	}
}
