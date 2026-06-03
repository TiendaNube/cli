import fs from "node:fs";
import path from "node:path";
import { Client, FileType } from "basic-ftp";
import { readdirpPromise } from "readdirp";
import { NubeCliLogger } from "../../../nube-cli-logger";
import type { ThemeFtpClientConfig } from "./theme-ftp-client-config";
import type { ThemeFtpClientResult } from "./theme-ftp-client-result";
import type { ThemeFtpDiffResult } from "./theme-ftp-diff-result";
import { ThemeFtpTools } from "./theme-ftp-tools";

export class ThemeFtpClient {
	private logger = new NubeCliLogger();
	private tools = new ThemeFtpTools();

	private config: ThemeFtpClientConfig;
	private FTP_PORT = 21;
	private FTP_TIMEOUT = 30000; // Default from basic-ftp
	private FTP_TEST_TIMEOUT = 5000;
	private MAX_PARALLEL_CONNECTIONS = 5;

	public constructor(config: ThemeFtpClientConfig) {
		this.config = config;
	}

	/** Remote paths on FTP must use POSIX separators regardless of host OS. */
	private toFtpRelativePath(relativePath: string): string {
		return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
	}

	/**
	 * After an upload, the server stamps its own mtime (≈ upload completion). Read it
	 * back via MDTM and copy onto the local file so future diffs see them as equal.
	 * Best-effort: failures are swallowed so a missing MDTM does not break the push.
	 */
	private async pullRemoteMtimeToLocal(
		client: Client,
		remotePath: string,
		localPath: string,
	): Promise<void> {
		try {
			const remoteMtime = await client.lastMod(remotePath);
			await fs.promises.utimes(localPath, remoteMtime, remoteMtime);
		} catch {
			// best-effort: server without MDTM, or local utimes failure
		}
	}

	async Upload(filePath: string): Promise<ThemeFtpClientResult> {
		const cwd = path.resolve("./");
		const relativePath = ThemeFtpTools.themeUploadRelativePath(cwd, filePath);
		if (relativePath === null) {
			return { success: true, errorMessage: "" };
		}
		let stats: fs.Stats;
		try {
			stats = await fs.promises.stat(filePath);
		} catch (err) {
			return {
				success: false,
				errorMessage: err instanceof Error ? err.message : String(err),
			} as ThemeFtpClientResult;
		}
		if (stats.size === 0) {
			return { success: true, errorMessage: "" };
		}
		const remoteRelative = this.toFtpRelativePath(relativePath);
		const remotePath = `/${remoteRelative}`;
		return await this.RunFtpCommand(async (client: Client) => {
			await client.uploadFrom(filePath, remotePath);
			await this.pullRemoteMtimeToLocal(client, remotePath, filePath);
		}, this.FTP_TIMEOUT);
	}

	async Delete(filePath: string): Promise<ThemeFtpClientResult> {
		const cwd = path.resolve("./");
		const relativePath = ThemeFtpTools.themeUploadRelativePath(cwd, filePath);
		if (relativePath === null) {
			return { success: true, errorMessage: "" };
		}
		const remoteRelative = this.toFtpRelativePath(relativePath);
		return await this.RunFtpCommand(async (client: Client) => {
			await client.remove(`/${remoteRelative}`);
		}, this.FTP_TIMEOUT);
	}

	private async ListRecursively(
		client: Client,
		currentPath: string,
	): Promise<
		Array<{ path: string; size: number; modifiedAt: Date | undefined }>
	> {
		const files = [];

		const listing = await client.list(currentPath);
		for (const item of listing) {
			if (item.type === FileType.File) {
				files.push({
					path: currentPath + item.name,
					size: item.size,
					modifiedAt: item.modifiedAt,
				});
			}
			if (item.type === FileType.Directory) {
				const dirPath = `${currentPath + item.name}/`;
				this.logger.Log(`  scanning ${dirPath}`);
				const recursiveFiles = await this.ListRecursively(client, dirPath);
				files.push(...recursiveFiles);
			}
		}
		return files;
	}

	async DownloadAll(): Promise<ThemeFtpClientResult> {
		let files: Array<{ path: string; modifiedAt: Date | undefined }> = [];

		const listResult = await this.RunFtpCommand(async (client: Client) => {
			files = (await this.ListRecursively(client, "/")).map((f) => ({
				path: f.path,
				modifiedAt: f.modifiedAt,
			}));
		}, this.FTP_TIMEOUT);

		if (!listResult.success) {
			return listResult;
		}

		const chunks = this.tools.ChunkArray(files, this.MAX_PARALLEL_CONNECTIONS);
		const promises = [];
		for (const chunk of chunks) {
			promises.push(this.DownloadParallel(chunk));
		}

		const results = await Promise.all(promises);
		for (const result of results) {
			if (!result.success) {
				return result;
			}
		}

		return { success: true, errorMessage: "" } as ThemeFtpClientResult;
	}

	private async DownloadParallel(
		files: Array<{ path: string; modifiedAt: Date | undefined }>,
	): Promise<ThemeFtpClientResult> {
		return await this.RunFtpCommand(async (client: Client) => {
			for (const file of files) {
				const localPath = `${path.resolve("./")}/${file.path.replace(/^\//, "")}`;
				const localFolder = path.dirname(localPath);
				if (!fs.existsSync(localFolder)) {
					fs.mkdirSync(localFolder, { recursive: true });
				}

				this.logger.Log(`Downloading file ${file.path}`);
				await client.downloadTo(localPath, file.path);
				// Preserve remote mtime locally so the next push diff matches without re-uploading.
				if (file.modifiedAt) {
					try {
						await fs.promises.utimes(
							localPath,
							file.modifiedAt,
							file.modifiedAt,
						);
					} catch {
						// best-effort: ignore failures (e.g. read-only fs)
					}
				}
			}
		}, this.FTP_TIMEOUT);
	}

	private needsUpload(
		localPath: string,
		remote: { size: number; modifiedAt: Date | undefined },
	): boolean {
		let stats: fs.Stats;
		try {
			stats = fs.statSync(localPath);
		} catch {
			return false;
		}
		// Size-0 files are never uploaded (basic-ftp SSL bug workaround), so treat as unchanged.
		if (stats.size === 0) return false;
		if (stats.size !== remote.size) return true;
		if (remote.modifiedAt === undefined) return true;
		return Math.abs(stats.mtimeMs - remote.modifiedAt.getTime()) > 2000;
	}

	async ComputeDiff(force = false): Promise<ThemeFtpDiffResult> {
		const cwd = path.resolve("./");
		let remoteFiles: Array<{
			path: string;
			size: number;
			modifiedAt: Date | undefined;
		}> = [];

		let localFiles: string[];
		let listResult: ThemeFtpClientResult;
		try {
			[localFiles, listResult] = await Promise.all([
				readdirpPromise(cwd, {
					alwaysStat: true,
					directoryFilter: (entry) =>
						!ThemeFtpTools.isExcludedFromThemeUpload(entry.path),
					fileFilter: (entry) =>
						!ThemeFtpTools.isExcludedFromThemeUpload(entry.path),
				}).then((entries) => entries.map((e) => e.fullPath)),
				this.RunFtpCommand(async (client: Client) => {
					this.logger.Log("Fetching remote files...");
					remoteFiles = await this.ListRecursively(client, "/");
				}, this.FTP_TIMEOUT),
			]);
		} catch (err) {
			return {
				success: false,
				errorMessage: err instanceof Error ? err.message : String(err),
			};
		}

		if (!listResult.success)
			return { success: false, errorMessage: listResult.errorMessage };

		const remoteFileMap = new Map(
			remoteFiles.map((f) => [
				f.path.replace(/^\/+/, ""),
				{ size: f.size, modifiedAt: f.modifiedAt },
			]),
		);
		const localRelSet = new Set<string>();
		const toCreate: string[] = [];
		const toUpdate: string[] = [];
		let unchangedCount = 0;

		for (const file of localFiles) {
			const rel = ThemeFtpTools.themeUploadRelativePath(cwd, file);
			if (rel === null) continue;
			const ftpRel = this.toFtpRelativePath(rel);
			localRelSet.add(ftpRel);
			const remoteInfo = remoteFileMap.get(ftpRel);
			if (remoteInfo === undefined) {
				toCreate.push(file);
			} else if (force || this.needsUpload(file, remoteInfo)) {
				toUpdate.push(file);
			} else {
				unchangedCount++;
			}
		}

		const toDelete = remoteFiles
			.filter((f) => !localRelSet.has(f.path.replace(/^\/+/, "")))
			.map((f) => f.path);

		return { success: true, toCreate, toUpdate, toDelete, unchangedCount };
	}

	async SyncAll(force = false): Promise<ThemeFtpClientResult> {
		const startTime = Date.now();

		const diff = await this.ComputeDiff(force);
		if (!diff.success) return diff;

		this.logger.Log(
			`Files to process: ${diff.toCreate.length} to create, ${diff.toUpdate.length} to update, ${diff.toDelete.length} to delete (${diff.unchangedCount} unchanged)`,
		);

		const allLocalFiles = [...diff.toCreate, ...diff.toUpdate];
		const uploadChunks = this.tools.ChunkArray(
			allLocalFiles,
			this.MAX_PARALLEL_CONNECTIONS,
		);
		const deleteChunks =
			diff.toDelete.length > 0
				? this.tools.ChunkArray(
						diff.toDelete,
						Math.min(diff.toDelete.length, this.MAX_PARALLEL_CONNECTIONS),
					)
				: [];

		const results = await Promise.all([
			...uploadChunks.map((chunk) => this.UploadParallel(chunk)),
			...deleteChunks.map((chunk) => this.DeleteParallel(chunk)),
		]);

		for (const result of results) {
			if (!result.success) return result;
		}

		const elapsed = Date.now() - startTime;
		this.logger.Log(
			`Done in ${elapsed}ms — created: ${diff.toCreate.length}, updated: ${diff.toUpdate.length}, deleted: ${diff.toDelete.length}, unchanged: ${diff.unchangedCount}`,
		);

		return { success: true, errorMessage: "" } as ThemeFtpClientResult;
	}

	private async UploadParallel(files: string[]): Promise<ThemeFtpClientResult> {
		const cwd = path.resolve("./");
		return await this.RunFtpCommand(async (client: Client) => {
			for (const file of files) {
				const rel = ThemeFtpTools.themeUploadRelativePath(cwd, file);
				if (rel === null) continue;

				// Likely a bug in basic-ftp, but if you attempt to upload a file with size 0, it will fail with an SSL error.
				const stats = fs.statSync(file);
				if (stats.size === 0) continue;

				const remotePath = `/${this.toFtpRelativePath(rel)}`;

				this.logger.Log(`Uploading file ${file}`);
				await client.uploadFrom(file, remotePath);
				await this.pullRemoteMtimeToLocal(client, remotePath, file);
			}
		}, this.FTP_TIMEOUT);
	}

	private async DeleteParallel(
		ftpPaths: string[],
	): Promise<ThemeFtpClientResult> {
		return await this.RunFtpCommand(async (client: Client) => {
			for (const ftpPath of ftpPaths) {
				this.logger.Log(`Deleting file ${ftpPath}`);
				await client.remove(ftpPath);
			}
		}, this.FTP_TIMEOUT);
	}

	async Test(): Promise<ThemeFtpClientResult> {
		let success = false;
		let errorMessage = "";
		const client = new Client(this.FTP_TEST_TIMEOUT);
		try {
			client.ftp.verbose = this.config.verbose;
			await client.access({
				host: this.config.ftpServer,
				port: this.FTP_PORT,
				user: this.config.ftpUsername,
				password: this.config.ftpPassword,
				secure: true,
			});
			success = true;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			client.close();
		}
		return {
			success: success,
			errorMessage: errorMessage,
		} as ThemeFtpClientResult;
	}

	private async RunFtpCommand(
		action: (client: Client) => Promise<void>,
		timeout: number,
	): Promise<ThemeFtpClientResult> {
		let success = false;
		let errorMessage = "";
		const client = new Client(timeout);
		try {
			client.ftp.verbose = this.config.verbose;
			await client.access({
				host: this.config.ftpServer,
				port: this.FTP_PORT,
				user: this.config.ftpUsername,
				password: this.config.ftpPassword,
				secure: true,
			});
			await action(client);
			success = true;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			client.close();
		}
		return {
			success: success,
			errorMessage: errorMessage,
		} as ThemeFtpClientResult;
	}
}
