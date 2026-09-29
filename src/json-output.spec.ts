import { stripVTControlCharacters } from "node:util";
import { Chalk } from "chalk";
import {
	type MockInstance,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { highlightJson, writeJsonOutput } from "./json-output";

const colorChalk = new Chalk({ level: 1 });
const sample = `${JSON.stringify(
	{
		name: "Theme 42",
		id: 42,
		ratio: -1.5e3,
		published: true,
		parent: null,
		tags: ["true", "null", "7"],
		quoted: 'say "hi": now',
	},
	null,
	2,
)}\n`;

describe("highlightJson", () => {
	it("keeps the text identical once colors are stripped", () => {
		const out = highlightJson(sample, colorChalk);
		expect(out).not.toBe(sample);
		expect(stripVTControlCharacters(out)).toBe(sample);
	});

	it("colors keys, strings, numbers, booleans and null differently", () => {
		const out = highlightJson(sample, colorChalk);
		expect(out).toContain(`${colorChalk.cyan('"id"')}:`);
		expect(out).toContain(colorChalk.green('"Theme 42"'));
		expect(out).toContain(colorChalk.yellow("42"));
		expect(out).toContain(colorChalk.yellow("-1500"));
		expect(out).toContain(colorChalk.magenta("true"));
		expect(out).toContain(colorChalk.gray("null"));
	});

	it("colors look-alike values inside strings as strings", () => {
		const out = highlightJson(sample, colorChalk);
		expect(out).toContain(colorChalk.green('"true"'));
		expect(out).toContain(colorChalk.green('"null"'));
		expect(out).toContain(colorChalk.green('"7"'));
		expect(out).toContain(colorChalk.green('"say \\"hi\\": now"'));
	});
});

describe("writeJsonOutput", () => {
	const originalIsTTY = process.stdout.isTTY;
	let stdoutSpy: MockInstance<typeof process.stdout.write>;

	function setStdoutTty(value: boolean): void {
		Object.defineProperty(process.stdout, "isTTY", {
			value,
			configurable: true,
		});
	}

	function written(): string {
		return String(stdoutSpy.mock.calls[0]?.[0] ?? "");
	}

	beforeEach(() => {
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.stubEnv("NO_COLOR", "");
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		vi.unstubAllEnvs();
		setStdoutTty(originalIsTTY);
	});

	it("writes the text untouched when stdout is not a TTY", () => {
		setStdoutTty(false);
		writeJsonOutput(sample, colorChalk);
		expect(written()).toBe(sample);
	});

	it("highlights when stdout is a color TTY", () => {
		setStdoutTty(true);
		writeJsonOutput(sample, colorChalk);
		expect(written()).not.toBe(sample);
		expect(stripVTControlCharacters(written())).toBe(sample);
	});

	it("writes the text untouched when NO_COLOR is set", () => {
		setStdoutTty(true);
		vi.stubEnv("NO_COLOR", "1");
		writeJsonOutput(sample, colorChalk);
		expect(written()).toBe(sample);
	});

	it("writes the text untouched when the terminal has no color support", () => {
		setStdoutTty(true);
		writeJsonOutput(sample, new Chalk({ level: 0 }));
		expect(written()).toBe(sample);
	});
});
