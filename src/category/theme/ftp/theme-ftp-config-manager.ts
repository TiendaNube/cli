import type { AuthCredentialsStore } from "../../auth/infra/auth-credentials-store";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type { ThemeSyncFamily } from "../theme-workspace-types";
import {
	type ResolveFtpCredentialsResult,
	resolveFtpCredentials,
} from "./theme-ftp-credentials";

export class ThemeFtpConfigManager {
	private workspace: ThemeWorkspaceConfigManager;

	public constructor(
		configFilePath = ".nuvem",
		private readonly store?: AuthCredentialsStore,
	) {
		this.workspace = new ThemeWorkspaceConfigManager(configFilePath);
	}

	IsSet(): boolean {
		return this.workspace.IsSet();
	}

	/** The FTP login for this run; see `resolveFtpCredentials` for the precedence. */
	TryLoad(options: { alias?: string } = {}): ResolveFtpCredentialsResult {
		return resolveFtpCredentials({
			alias: options.alias,
			workspace: this.workspace,
			store: this.store,
		});
	}

	/** Records that the local files came from an FTP pull. */
	MarkPulled(): void {
		this.workspace.recordLastSync("ftp");
	}

	/** Which family last pulled the local files, if it was ever recorded. */
	LastSync(): ThemeSyncFamily | undefined {
		return this.workspace.readLastSync();
	}
}
