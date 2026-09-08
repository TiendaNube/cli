import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ConfigPathEnvironment,
	resolveUserConfigDir,
	resolveUserConfigPath,
} from "./telemetry-config-path";

function environment(
	overrides: Partial<ConfigPathEnvironment> = {},
): ConfigPathEnvironment {
	return {
		env: {},
		platform: "linux",
		homedir: "/home/dev",
		...overrides,
	};
}

describe("resolveUserConfigDir", () => {
	it("uses ~/.config on Linux", () => {
		expect(resolveUserConfigDir(environment())).toBe(
			path.posix.join("/home/dev", ".config", "tiendanube-cli"),
		);
	});

	it("uses ~/.config on macOS too, matching developer CLI convention", () => {
		expect(
			resolveUserConfigDir(
				environment({ platform: "darwin", homedir: "/Users/dev" }),
			),
		).toBe(path.posix.join("/Users/dev", ".config", "tiendanube-cli"));
	});

	it("honors an absolute XDG_CONFIG_HOME", () => {
		expect(
			resolveUserConfigDir(
				environment({ env: { XDG_CONFIG_HOME: "/custom/config" } }),
			),
		).toBe(path.posix.join("/custom/config", "tiendanube-cli"));
	});

	it("ignores a relative XDG_CONFIG_HOME, as the spec requires", () => {
		expect(
			resolveUserConfigDir(
				environment({ env: { XDG_CONFIG_HOME: "relative/config" } }),
			),
		).toBe(path.posix.join("/home/dev", ".config", "tiendanube-cli"));
	});

	it("uses %APPDATA% on Windows", () => {
		expect(
			resolveUserConfigDir(
				environment({
					platform: "win32",
					homedir: "C:\\Users\\dev",
					env: { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
				}),
			),
		).toBe(
			path.win32.join("C:\\Users\\dev\\AppData\\Roaming", "tiendanube-cli"),
		);
	});

	it("falls back to the Roaming path when %APPDATA% is unset", () => {
		expect(
			resolveUserConfigDir(
				environment({ platform: "win32", homedir: "C:\\Users\\dev" }),
			),
		).toBe(
			path.win32.join("C:\\Users\\dev", "AppData", "Roaming", "tiendanube-cli"),
		);
	});

	it("ignores a relative %APPDATA%, judged by Windows rules on any host", () => {
		expect(
			resolveUserConfigDir(
				environment({
					platform: "win32",
					homedir: "C:\\Users\\dev",
					env: { APPDATA: "AppData\\Roaming" },
				}),
			),
		).toBe(
			path.win32.join("C:\\Users\\dev", "AppData", "Roaming", "tiendanube-cli"),
		);
	});

	it("does not vary with the invoked bin name", () => {
		// One directory for both `tiendanube` and `nuvemshop`, so consent is asked once.
		expect(resolveUserConfigDir(environment())).toContain("tiendanube-cli");
	});
});

describe("resolveUserConfigPath", () => {
	it("appends config.json to the directory", () => {
		expect(resolveUserConfigPath(environment())).toBe(
			path.posix.join("/home/dev", ".config", "tiendanube-cli", "config.json"),
		);
	});
});
