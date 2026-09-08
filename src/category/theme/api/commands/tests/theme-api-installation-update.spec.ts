import "./theme-api-command-test-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeApiInstallationUpdateCommand } from "../theme-api-installation-update";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import type { StderrWriteSpy } from "./stderr-write-spy";
import type { StdoutWriteSpy } from "./stdout-write-spy";
import {
	forceInteractiveTestEnv,
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

describe("ThemeApiInstallationUpdateCommand", () => {
	let stdoutSpy: StdoutWriteSpy;
	let stderrSpy: StderrWriteSpy;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	function withConfig(themeId?: string): void {
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: {
				publicApiToken: "t",
				storeId: "1",
				...(themeId !== undefined ? { themeId } : {}),
			},
		};
	}

	function report(overrides: Record<string, unknown> = {}): void {
		themeApiCmdMocks.testUpdateInstallation.mockResolvedValue({
			baseline_version: "1.0.0",
			target_version: "2.0.0",
			conflicts: 0,
			conflicting_files: [],
			...overrides,
		});
	}

	/**
	 * Every run now asks the API which versions are on offer before doing anything
	 * else. Forked by default (exact versions); pass `forked: false` for the
	 * major-tracking shape.
	 */
	function targets(
		list: string[] = ["2.0.0", "1.1.0"],
		opts: { forked?: boolean; currentVersion?: string } = {},
	): void {
		themeApiCmdMocks.getUpdateTargets.mockResolvedValue({
			forked: opts.forked ?? true,
			current_version: opts.currentVersion ?? "1.0.0",
			targets: list,
		});
	}

	/**
	 * Titles the update command resolves via `getInstallation` for its "<title>
	 * (<id>)" labels. Ids not listed resolve to a body with no title, exercising
	 * the bare-id fallback.
	 */
	function installations(byId: Record<string, string>): void {
		themeApiCmdMocks.getInstallation.mockImplementation((id: string) =>
			Promise.resolve(id in byId ? { id, title: byId[id] } : { id }),
		);
	}

	function program() {
		return programWithThemeCommand((c) => {
			new ThemeApiInstallationUpdateCommand().Bind(c);
		});
	}

	it("errors when config load fails", async () => {
		await parseWithTail(program(), ["theme", "update", "--to", "2.0.0", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
	});

	it("errors when theme id missing", async () => {
		withConfig();
		await parseWithTail(program(), ["theme", "update", "--to", "2.0.0", "-y"]);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"No theme id: pass --theme-id, use --published, or run tiendanube theme pull --theme-id <id> (saves to .nuvem).",
		);
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("rejects a --to that is not one of the available versions, naming them", async () => {
		withConfig("10");
		targets(["2.0.0", "1.1.0"]);

		await parseWithTail(program(), ["theme", "update", "--to", "latest", "-y"]);

		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"latest is not a version this theme can update to. Available: 2.0.0, 1.1.0.",
		);
		expect(themeApiCmdMocks.testUpdateInstallation).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("rejects an exact version when the theme tracks majors", async () => {
		// The shapes are not interchangeable, and the list is what says which one
		// this theme takes — so the wrong shape is simply not on it.
		withConfig("10");
		targets(["3", "2"], { forked: false, currentVersion: "1" });

		await parseWithTail(program(), ["theme", "update", "--to", "2.1.1", "-y"]);

		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"2.1.1 is not a version this theme can update to. Available: 3, 2.",
		);
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("stops without asking anything when there is no newer version", async () => {
		withConfig("10");
		targets([], { currentVersion: "2.0.0" });
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update"]);

		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme is already on the latest version (v2.0.0); nothing to update.",
		);
		expect(themeApiCmdMocks.select).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.testUpdateInstallation).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("offers the available versions and updates to the one picked", async () => {
		withConfig("10");
		targets(["2.1.1", "2.1.0", "1.1.0"]);
		report({ target_version: "2.1.0" });
		installations({ "10": "Base" });
		themeApiCmdMocks.select.mockResolvedValue("2.1.0");
		themeApiCmdMocks.confirm.mockResolvedValue(true);
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update"]);

		const [message, choices] = themeApiCmdMocks.select.mock.calls[0] ?? [];
		expect(String(message)).toContain("currently 1.0.0");
		// Newest first, exactly as the API ordered them.
		expect(choices).toEqual([
			{ value: "2.1.1" },
			{ value: "2.1.0" },
			{ value: "1.1.0" },
		]);
		// Title defaults to "<source> (<version>)"; the input prompt accepts it.
		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"10",
			"2.1.0",
			"Base (v2.1.0)",
		);
	});

	it("forwards the picked major verbatim when the theme is not forked", async () => {
		withConfig("10");
		targets(["3", "2"], { forked: false, currentVersion: "1" });
		report({ baseline_version: "1", target_version: "3" });
		installations({ "10": "Base" });
		themeApiCmdMocks.select.mockResolvedValue("3");
		themeApiCmdMocks.confirm.mockResolvedValue(true);
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update"]);

		// Same prompt whether forked or not — no "major" wording to reason about.
		expect(String(themeApiCmdMocks.select.mock.calls[0]?.[0] ?? "")).toContain(
			"Update to which version?",
		);
		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"10",
			"3",
			"Base (v3)",
		);
	});

	it("requires --to when it cannot prompt, listing the available versions", async () => {
		// Non-interactive is the default in these tests (CI parity).
		withConfig("10");
		targets(["2.0.0", "1.1.0"]);

		await parseWithTail(program(), ["theme", "update", "-y"]);

		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"A target version is required (--to). Available: 2.0.0, 1.1.0.",
		);
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("dry-runs first, then updates, forwarding the pin verbatim", async () => {
		withConfig("10");
		targets(["2"], { forked: false, currentVersion: "1" });
		report({ baseline_version: "1", target_version: "2" });
		installations({ "10": "My Theme", "11": "My Theme (v2)" });
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });

		await parseWithTail(program(), ["theme", "update", "--to", "2", "-y"]);

		expect(themeApiCmdMocks.testUpdateInstallation).toHaveBeenCalledWith(
			"10",
			"2",
		);
		// Read-before-write: the dry-run report must precede the actual update.
		expect(
			themeApiCmdMocks.testUpdateInstallation.mock.invocationCallOrder[0],
		).toBeLessThan(
			themeApiCmdMocks.updateInstallation.mock.invocationCallOrder[0],
		);
		// A major pin stays a pin — resolving it here would freeze the new theme.
		// Non-interactive: title defaults to "<source> (v<version>)".
		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"10",
			"2",
			"My Theme (v2)",
		);
		// Both themes are named "<title> (<id>)", source and freshly created.
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme 'My Theme (v2)' (11) was created with version 2. Pull the theme to get the updated files.",
		);
	});

	it("falls back to the bare id when a theme has no title", async () => {
		withConfig("10");
		targets(["2"], { forked: false, currentVersion: "1" });
		report({ baseline_version: "1" });
		// No installations() mock: getInstallation resolves to a title-less body.
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });

		await parseWithTail(program(), ["theme", "update", "--to", "2", "-y"]);

		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"Theme 11 was created with version 2.0.0. Pull the theme to get the updated files.",
		);
	});

	it("forwards the title when given", async () => {
		withConfig("10");
		targets();
		report();
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });

		await parseWithTail(program(), [
			"theme",
			"update",
			"--to",
			"2.0.0",
			"--title",
			"My upgrade",
			"-y",
		]);

		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"10",
			"2.0.0",
			"My upgrade",
		);
	});

	it("prompts for the title with a '<source> (<version>)' default and forwards the edit", async () => {
		withConfig("10");
		targets(["2"], { forked: false, currentVersion: "1" });
		report({ baseline_version: "1", target_version: "2" });
		installations({ "10": "Base" });
		themeApiCmdMocks.confirm.mockResolvedValue(true);
		themeApiCmdMocks.input.mockResolvedValue("My renamed theme");
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update", "--to", "2"]);

		// The prompt is pre-filled with the derived default.
		expect(themeApiCmdMocks.input.mock.calls[0]?.[1]).toMatchObject({
			initialValue: "Base (v2)",
		});
		// The user's edited value is forwarded verbatim.
		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"10",
			"2",
			"My renamed theme",
		);
	});

	it("does not update when the confirmation is declined", async () => {
		withConfig("10");
		targets();
		report({ conflicts: 1, conflicting_files: ["sections/hero.tpl"] });
		themeApiCmdMocks.confirm.mockResolvedValue(false);
		// -y would bypass the prompt, so this run must not pass it.
		forceInteractiveTestEnv();
		await parseWithTail(program(), ["theme", "update", "--to", "2.0.0"]);

		expect(themeApiCmdMocks.testUpdateInstallation).toHaveBeenCalled();
		expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
	});

	it("names the conflicting files in the confirmation prompt", async () => {
		withConfig("10");
		targets();
		report({
			conflicts: 2,
			conflicting_files: ["sections/hero.tpl", "snippets/nav.tpl"],
		});
		themeApiCmdMocks.confirm.mockResolvedValue(false);
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update", "--to", "2.0.0"]);

		// The whole report is a multi-line prompt: report, conflict list, and the
		// question each on their own line (clack prefixes every line).
		const prompt = String(themeApiCmdMocks.confirm.mock.calls[0]?.[0] ?? "");
		const lines = prompt.split("\n");
		expect(prompt).toContain("2 conflicts found:");
		expect(lines).toContain("  - sections/hero.tpl");
		expect(lines).toContain("  - snippets/nav.tpl");
		expect(lines).toContain("Do you want to continue?");
	});

	it("omits the conflict block when the update is clean", async () => {
		withConfig("10");
		targets();
		report();
		themeApiCmdMocks.confirm.mockResolvedValue(false);
		forceInteractiveTestEnv();

		await parseWithTail(program(), ["theme", "update", "--to", "2.0.0"]);

		const prompt = String(themeApiCmdMocks.confirm.mock.calls[0]?.[0] ?? "");
		expect(prompt).toContain("The update creates a new draft");
		expect(prompt).not.toContain("conflict");
		expect(prompt).not.toContain("will be replaced");
	});

	describe("--dry-run", () => {
		it("reports without updating", async () => {
			withConfig("10");
			targets();
			report({ conflicts: 1, conflicting_files: ["sections/hero.tpl"] });
			installations({ "10": "My Theme" });

			await parseWithTail(program(), [
				"theme",
				"update",
				"--to",
				"2.0.0",
				"--dry-run",
				"-y",
			]);

			expect(themeApiCmdMocks.testUpdateInstallation).toHaveBeenCalledWith(
				"10",
				"2.0.0",
			);
			expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
			const logged = themeApiCmdMocks.log.mock.calls
				.map((c) => String(c[0]))
				.join("\n");
			expect(logged).toContain("Updating from 1.0.0 to 2.0.0.");
			expect(logged).toContain(
				"The update creates a new draft, the theme 'My Theme' (10) is left untouched.",
			);
			expect(logged).toContain("1 conflict found:");
			expect(logged).toContain("  - sections/hero.tpl");
			expect(logged).toContain("Dry run: nothing was changed.");
		});

		it("writes the report as JSON when --json", async () => {
			withConfig("10");
			targets();
			report({ conflicts: 1, conflicting_files: ["sections/hero.tpl"] });

			await parseWithTail(program(), [
				"theme",
				"update",
				"--to",
				"2.0.0",
				"--dry-run",
				"--json",
				"-y",
			]);

			const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
			expect(JSON.parse(written)).toEqual({
				theme_id: "10",
				current_version: "1.0.0",
				target_version: "2.0.0",
				conflicts: 1,
				conflicting_files: ["sections/hero.tpl"],
			});
			expect(themeApiCmdMocks.updateInstallation).not.toHaveBeenCalled();
			expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
		});
	});

	it("writes the new theme as JSON when --json", async () => {
		withConfig("10");
		targets();
		report();
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "11" });

		await parseWithTail(program(), [
			"theme",
			"update",
			"--to",
			"2.0.0",
			"-y",
			"--json",
		]);

		const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
		expect(JSON.parse(written)).toEqual({ id: "11" });
		expect(themeApiCmdMocks.log).not.toHaveBeenCalled();
	});

	it("resolves the theme via --published", async () => {
		withConfig();
		themeApiCmdMocks.listInstallations.mockResolvedValue({
			installations: [
				{ id: 100, is_productive: false },
				{ id: 200, is_productive: true },
			],
		});
		targets();
		report();
		themeApiCmdMocks.updateInstallation.mockResolvedValue({ id: "300" });

		await parseWithTail(program(), [
			"theme",
			"update",
			"--to",
			"2.0.0",
			"--published",
			"-y",
		]);

		// Source (id 200) has no title here, so the default title falls back.
		expect(themeApiCmdMocks.updateInstallation).toHaveBeenCalledWith(
			"200",
			"2.0.0",
			"Updated draft",
		);
	});
});
