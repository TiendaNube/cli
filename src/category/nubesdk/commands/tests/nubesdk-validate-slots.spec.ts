import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.fn();
const error = vi.fn();

vi.mock("../../../../cli-logger", () => ({
	CliLogger: vi.fn().mockImplementation(() => ({
		Log: log,
		Error: error,
	})),
}));

vi.mock("../../scan-theme-slots", () => ({
	ScanThemeForNubesdkSlots: vi.fn().mockResolvedValue({
		found: new Set<string>(),
		directCanonical: new Set<string>(),
		legacyDomByCanonical: new Map<string, string>(),
		indirectViaProductItemImage: new Map<string, string>(),
		tplFilesAnalyzed: 0,
	}),
}));

import { NubesdkValidateSlotsCommand } from "../nubesdk-validate-slots";
import { parseWithTail, programWithNubesdkSubcommand } from "./helpers";

describe("NubesdkValidateSlotsCommand", () => {
	beforeEach(() => {
		log.mockClear();
		error.mockClear();
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = undefined;
	});

	it("logs error when --dir does not exist", async () => {
		const program = programWithNubesdkSubcommand((c) => {
			new NubesdkValidateSlotsCommand().Bind(c);
		});
		const missing = path.join(os.tmpdir(), `nube-cli-missing-${Date.now()}`);
		await parseWithTail(program, [
			"nubesdk",
			"validate-slots",
			"--dir",
			missing,
		]);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("Directory not found:"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("logs error for invalid --output-file name", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nube-cli-nubesdk-"));
		const program = programWithNubesdkSubcommand((c) => {
			new NubesdkValidateSlotsCommand().Bind(c);
		});
		try {
			await parseWithTail(program, [
				"nubesdk",
				"validate-slots",
				"--dir",
				dir,
				"--output-file",
				".",
			]);
			expect(error).toHaveBeenCalledWith(
				"Invalid --output-file: use a non-empty file name (e.g. slots-report).",
			);
			expect(process.exitCode).toBe(1);
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it("binds validate-slots subcommand on nubesdk", () => {
		const root = new Command();
		const nubesdk = new Command("nubesdk");
		new NubesdkValidateSlotsCommand().Bind(nubesdk);
		root.addCommand(nubesdk);
		const names = nubesdk.commands.map((c) => c.name());
		expect(names).toContain("validate-slots");
	});
});
