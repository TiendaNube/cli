import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { CliLogger } from "../../../cli-logger";
import { ThemeCommands } from "../theme-commands";

const DEPRECATED_VERBS = [
	"list",
	"create",
	"clone",
	"publish",
	"fork",
	"preview",
	"delete",
	"current",
];

function findInstallationSubgroup(): Command {
	const root = new Command();
	new ThemeCommands().Bind(root);
	const theme = root.commands.find((c) => c.name() === "theme");
	const installation = theme?.commands.find((c) => c.name() === "installation");
	if (!installation) {
		throw new Error("installation subgroup not registered");
	}
	return installation;
}

describe("Deprecated 'theme installation' aliases", () => {
	it("registers a hidden 'installation' subgroup under theme with all expected verbs", () => {
		const installation = findInstallationSubgroup();
		expect((installation as unknown as { _hidden: boolean })._hidden).toBe(
			true,
		);
		expect(installation.commands.map((c) => c.name()).sort()).toEqual(
			[...DEPRECATED_VERBS].sort(),
		);
	});

	it("emits the deprecation warning via CliLogger.Warn for each verb", () => {
		const installation = findInstallationSubgroup();
		const hooks = (
			installation as unknown as {
				_lifeCycleHooks: Record<
					string,
					Array<(thisCommand: Command, actionCommand: Command) => void>
				>;
			}
		)._lifeCycleHooks;
		expect(hooks.preAction).toHaveLength(1);
		const hook = hooks.preAction[0];

		for (const verb of DEPRECATED_VERBS) {
			const warnSpy = vi
				.spyOn(CliLogger.prototype, "Warn")
				.mockImplementation(() => {});
			hook(installation, new Command(verb));
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(warnSpy).toHaveBeenCalledWith(
				`Warning: 'theme installation ${verb}' is deprecated. Use 'theme ${verb}' instead.`,
			);
			warnSpy.mockRestore();
		}
	});
});
