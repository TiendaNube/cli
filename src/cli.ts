import { Command } from "commander";
import updateNotifier from "update-notifier";
import packageJson from "../package.json" with { type: "json" };
import { NubesdkCommands } from "./category/nubesdk/nubesdk";
import { ThemeCommands } from "./category/theme/theme-commands";
import { getCliExecutableName } from "./cli-executable-name";

const program = new Command();

program
	.name(getCliExecutableName())
	.description(packageJson.description)
	.version(packageJson.version);

// NubeSDK commands are hidden until NubeSDK support on Core Storefronts is publicly announced
// new NubesdkCommands().Bind(program);
new ThemeCommands().Bind(program);

updateNotifier({
	pkg: { name: packageJson.name, version: packageJson.version },
}).notify();

program.parse(process.argv);
