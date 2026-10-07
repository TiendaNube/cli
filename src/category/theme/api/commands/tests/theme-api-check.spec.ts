import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "./theme-api-command-test-mocks";
import {
	type MockInstance,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ThemeApiCheckCommand } from "../theme-api-check";
import { parseWithTail, programWithThemeCommand } from "./helpers";
import {
	resetThemeApiCmdMocks,
	themeApiCmdMocks,
} from "./theme-api-command-test-mocks";

const readdirpMocks = vi.hoisted(() => ({
	readdirpPromise: vi.fn(),
}));

vi.mock("readdirp", () => ({
	readdirpPromise: readdirpMocks.readdirpPromise,
}));

const cwd = path.resolve("./");

function runCheck(tail: string[] = []): Promise<void> {
	const program = programWithThemeCommand((c) => {
		new ThemeApiCheckCommand().Bind(c);
	});
	return parseWithTail(program, ["theme", "check", ...tail]);
}

describe("ThemeApiCheckCommand", () => {
	let readFileSpy: MockInstance | undefined;

	beforeEach(() => {
		resetThemeApiCmdMocks();
		readdirpMocks.readdirpPromise.mockReset().mockResolvedValue([]);
		themeApiCmdMocks.tryLoadResult = {
			success: true,
			config: { publicApiToken: "t", storeId: "1", themeId: "9" },
		};
		themeApiCmdMocks.getInstallation.mockResolvedValue({ forked: true });
		themeApiCmdMocks.getFileHashes.mockResolvedValue({ hashes: {} });
	});

	afterEach(() => {
		// Only the fs spy: restoreAllMocks would also wipe the shared command mocks.
		readFileSpy?.mockRestore();
		readFileSpy = undefined;
	});

	it("errors when TryLoadApiConfig fails and never calls the API", async () => {
		themeApiCmdMocks.tryLoadResult = { success: false, error: "no config" };
		await runCheck();
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith("no config");
		expect(themeApiCmdMocks.validateFiles).not.toHaveBeenCalled();
	});

	it("validates only the files a push would send, skipping unchanged ones", async () => {
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("ok", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "snippets", "same.tpl") },
			{ fullPath: path.join(cwd, "snippets", "changed.tpl") },
		]);
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: {
				"snippets/same.tpl": crypto
					.createHash("md5")
					.update("ok")
					.digest("hex"),
				"snippets/changed.tpl": crypto
					.createHash("md5")
					.update("old")
					.digest("hex"),
			},
		});

		await runCheck();

		expect(themeApiCmdMocks.validateFiles).toHaveBeenCalledTimes(1);
		const sent = themeApiCmdMocks.validateFiles.mock.calls[0][1] as {
			path: string;
		}[];
		expect(sent.map((f) => f.path)).toEqual(["snippets/changed.tpl"]);
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"All 1 file(s) are valid.",
		);
		expect(themeApiCmdMocks.error).not.toHaveBeenCalled();
	});

	it("does not call validate when nothing differs from the remote", async () => {
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("ok", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "snippets", "same.tpl") },
		]);
		themeApiCmdMocks.getFileHashes.mockResolvedValue({
			hashes: {
				"snippets/same.tpl": crypto
					.createHash("md5")
					.update("ok")
					.digest("hex"),
			},
		});

		await runCheck();

		expect(themeApiCmdMocks.validateFiles).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.log).toHaveBeenCalledWith(
			"No changed files to check.",
		);
		expect(themeApiCmdMocks.error).not.toHaveBeenCalled();
	});

	it("never uploads or deletes anything", async () => {
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("ok", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "snippets", "a.tpl") },
		]);

		await runCheck();

		expect(themeApiCmdMocks.batchUpdateFiles).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.upsertFile).not.toHaveBeenCalled();
		expect(themeApiCmdMocks.deleteFile).not.toHaveBeenCalled();
	});

	it("reports each invalid file and fails", async () => {
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("{% if a %}", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "sections", "broken.tpl") },
		]);
		themeApiCmdMocks.validateFiles.mockResolvedValue([
			{
				path: "sections/broken.tpl",
				code: "TWIG_SYNTAX_ERROR",
				message: "Twig syntax error: Unexpected end of template. (line 1).",
			},
		]);

		await runCheck();

		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"  Invalid: sections/broken.tpl — Twig syntax error: Unexpected end of template. (line 1).",
		);
		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"Check failed: 1 file(s) failed validation.",
		);
	});

	it("fails when the API does not support validation", async () => {
		readFileSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue(Buffer.from("ok", "utf8"));
		readdirpMocks.readdirpPromise.mockResolvedValue([
			{ fullPath: path.join(cwd, "snippets", "a.tpl") },
		]);
		themeApiCmdMocks.validateFiles.mockResolvedValue(null);

		await runCheck();

		expect(themeApiCmdMocks.error).toHaveBeenCalledWith(
			"This store's API does not support file validation yet.",
		);
	});
});
