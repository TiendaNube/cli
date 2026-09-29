import type { Command } from "commander";
import { CliError, runAction } from "../../../../cli-action";
import { getCliExecutableName } from "../../../../cli-executable-name";
import { CliInteraction } from "../../../../cli-interaction";
import { CliLogger } from "../../../../cli-logger";
import { confirmOrAbort, yesFlagSet } from "../../../../interactivity";
import {
	crossFamilyForcedNotice,
	crossFamilyPushRefusal,
} from "../../theme-workspace-sync-origin";
import { ThemeFtpClient } from "../theme-ftp-client";
import type { ThemeFtpClientConfig } from "../theme-ftp-client-config";
import { ThemeFtpConfigManager } from "../theme-ftp-config-manager";

type PushOptions = {
	v: boolean;
	force: boolean;
};

export class ThemeFtpPushCommand {
	private logger = new CliLogger();
	private interaction = new CliInteraction();
	private config = new ThemeFtpConfigManager();

	private async Execute(options: PushOptions, command: Command): Promise<void> {
		if (!this.config.IsSet()) {
			throw new CliError(
				`Store configuration not found. Please run ${getCliExecutableName()} theme ftp setup first.`,
			);
		}

		// A workspace may hold both credential families, so the local files could
		// have come from an API pull. Uploading those over FTP would send a
		// sections-based tree to a classic theme.
		const lastSync = this.config.LastSync();
		if (!options.force) {
			const refusal = crossFamilyPushRefusal({ target: "ftp", lastSync });
			if (refusal !== null) {
				throw new CliError(refusal);
			}
		}

		const loaded = this.config.TryLoad();
		if (!loaded.success) {
			throw new CliError(loaded.error);
		}
		const ftpConfig: ThemeFtpClientConfig = loaded.config.ftp;
		ftpConfig.verbose = options.v;
		const client = new ThemeFtpClient(ftpConfig);

		// Default path: diff before asking, so the confirmation states what will
		// actually happen instead of a generic warning. FTP writes to the published
		// theme and is live on the spot, and there is no undo — a blind yes is the
		// wrong ask. The result is handed to SyncAll so the remote is listed once.
		//
		// --force deliberately opts out of all of that: it means "upload everything,
		// I am not asking what changes". So it skips the pre-flight entirely rather
		// than computing a summary nobody wanted, which also saves a full listing.
		let diff: Awaited<ReturnType<ThemeFtpClient["ComputeDiff"]>> | undefined;
		let summary: string | undefined;
		if (!options.force) {
			const computed = await client.ComputeDiff(false);
			if (!computed.success) {
				throw new CliError(`Sync failed: ${computed.errorMessage}`);
			}
			diff = computed;
			summary = `${computed.toCreate.length} file(s) to add, ${computed.toUpdate.length} to modify, and ${computed.toDelete.length} to delete from the remote theme`;

			// --yes returns from confirmOrAbort without rendering the message, so
			// counts that cost a full remote listing would be discarded exactly where
			// no human is watching. For a scripted push this is the only record.
			if (yesFlagSet(command)) {
				this.logger.Log(`Pending changes: ${summary}.`);
			}
		}

		const confirmed = await confirmOrAbort(
			command,
			this.interaction,
			summary === undefined
				? `--force uploads every local file to the theme published in your store, so shoppers see it immediately, and deletes remote files that no longer exist locally. The change summary is skipped.${crossFamilyForcedNotice(
						{ target: "ftp", lastSync },
					)} Do you want to continue?`
				: `This uploads to the theme published in your store, so shoppers see it immediately: ${summary}.${crossFamilyForcedNotice(
						{ target: "ftp", lastSync },
					)} Do you want to continue?`,
		);
		if (!confirmed) {
			return;
		}

		this.logger.Log(
			options.force
				? "Starting sync with FTP server (--force: uploading all files)"
				: "Starting sync with FTP server",
		);
		const result = await client.SyncAll(options.force, diff);
		if (!result.success) {
			throw new CliError(`Sync failed: ${result.errorMessage}`);
		}
	}

	Bind(command: Command): void {
		command
			.command("push")
			.description(
				"Upload theme files from the current directory to the FTP server",
			)
			.option("-v", "Enable verbose logging", false)
			.option(
				"--force",
				"Upload all files without comparing against the remote, skipping the change summary",
				false,
			)
			.action(
				runAction((options: PushOptions, command: Command) =>
					this.Execute(options, command),
				),
			);
	}
}
