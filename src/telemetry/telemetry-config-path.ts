import os from "node:os";
import path from "node:path";

/** Shared by both bin names (`tiendanube`, `nuvemshop`) so one user has one setting. */
export const TELEMETRY_CONFIG_DIR_NAME = "tiendanube-cli";
export const TELEMETRY_CONFIG_FILE_NAME = "config.json";

/** Injected in tests so every platform layout can be asserted from any host OS. */
export type ConfigPathEnvironment = {
	env: Record<string, string | undefined>;
	platform: string;
	homedir: string;
};

function currentEnvironment(): ConfigPathEnvironment {
	return {
		env: process.env,
		platform: process.platform,
		homedir: os.homedir(),
	};
}

/**
 * The platform-specific `path` flavour rather than the host default: `path.isAbsolute`
 * and `path.join` follow the machine they run on, so a `C:\…` value would be judged
 * relative on POSIX. Selecting explicitly keeps each layout correct in production
 * and assertable from any host in tests.
 */
function pathForPlatform(platform: string): typeof path.posix {
	return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Per-user configuration directory holding the telemetry setting.
 *
 * Deliberately keyed to the user + machine rather than to the installation:
 * global (`-g`) installs live under a Node-version-scoped prefix that is wiped on
 * every Node upgrade, local installs live in a gitignored `node_modules`, and
 * `npx` runs from an ephemeral cache. Storing the setting next to any of those
 * would either lose it or fragment one developer across many identities.
 *
 * macOS follows the Linux/XDG layout rather than `~/Library/Application Support`:
 * developer CLIs (git, gh, kubectl) converged on `~/.config`, which is also
 * greppable and documentable for the people who use this tool.
 */
export function resolveUserConfigDir(
	environment: ConfigPathEnvironment = currentEnvironment(),
): string {
	const { env, platform, homedir } = environment;
	const platformPath = pathForPlatform(platform);

	if (platform === "win32") {
		// %APPDATA% (Roaming) rather than %LOCALAPPDATA%: when a domain profile
		// roams, one person's machines collapse into a single identity, which is
		// what a *user* metric wants.
		const appData = env.APPDATA;
		const base =
			appData !== undefined && platformPath.isAbsolute(appData)
				? appData
				: platformPath.join(homedir, "AppData", "Roaming");
		return platformPath.join(base, TELEMETRY_CONFIG_DIR_NAME);
	}

	// The XDG spec requires relative values to be ignored.
	const xdgConfigHome = env.XDG_CONFIG_HOME;
	const base =
		xdgConfigHome !== undefined && platformPath.isAbsolute(xdgConfigHome)
			? xdgConfigHome
			: platformPath.join(homedir, ".config");
	return platformPath.join(base, TELEMETRY_CONFIG_DIR_NAME);
}

export function resolveUserConfigPath(
	environment: ConfigPathEnvironment = currentEnvironment(),
): string {
	return pathForPlatform(environment.platform).join(
		resolveUserConfigDir(environment),
		TELEMETRY_CONFIG_FILE_NAME,
	);
}
