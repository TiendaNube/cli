import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import type { ThemeSyncFamily } from "../theme-workspace-types";
import type { ThemeFtpConfig } from "./theme-ftp-config";

export class ThemeFtpConfigManager {
	private workspace: ThemeWorkspaceConfigManager;

	public constructor(configFilePath = ".nuvem") {
		this.workspace = new ThemeWorkspaceConfigManager(configFilePath);
	}

	IsSet(): boolean {
		return this.workspace.IsSet();
	}

	Save(configuration: ThemeFtpConfig): void {
		this.workspace.mergeWorkspace({
			themeManagement: "ftp",
			"theme-ftp": configuration,
		});
	}

	TryLoad():
		| { success: true; config: ThemeFtpConfig }
		| { success: false; error: string } {
		return this.workspace.TryLoadFtpConfig();
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
