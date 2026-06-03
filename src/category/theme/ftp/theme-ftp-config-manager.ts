import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
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
}
