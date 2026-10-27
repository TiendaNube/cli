import { Chalk } from "chalk";
import { describe, expect, it } from "vitest";
import {
	displayPath,
	formatCredentialTable,
	relativeDay,
} from "./auth-list-format";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ROWS = [
	{
		alias: "shop",
		tokens: ["api" as const, "ftp" as const],
		storeId: "1",
		host: "shop.lojavirtualnuvem.com.br",
		lastUsedAt: "2026-10-01T08:00:00.000Z",
		currentFolder: true,
		default: true,
		status: { api: "ok" as const, ftp: "rejected" as const },
	},
	{
		alias: "a-much-longer-alias",
		tokens: ["ftp" as const],
		storeId: null,
		host: "classic.example",
		lastUsedAt: null,
		currentFolder: false,
		default: false,
		status: { ftp: "unreachable" as const },
	},
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("formatCredentialTable", () => {
	it("aligns every column on the visible text, with or without color", () => {
		const plain = formatCredentialTable(ROWS, {
			chalk: new Chalk({ level: 0 }),
			now: NOW,
		});
		const colored = formatCredentialTable(ROWS, {
			chalk: new Chalk({ level: 1 }),
			now: NOW,
		});

		expect(colored).not.toBe(plain);
		expect(stripAnsi(colored)).toBe(plain);
		expect(plain.split("\n")).toEqual([
			"   ALIAS                STORE                            CREDENTIALS           LAST USED",
			">  shop (default)       shop.lojavirtualnuvem.com.br #1  API ok, FTP rejected  today",
			"   a-much-longer-alias  classic.example                  FTP unreachable       never",
		]);
	});

	it("colors status by meaning: green ok, red rejected, yellow unreachable", () => {
		const chalk = new Chalk({ level: 1 });
		const out = formatCredentialTable(ROWS, { chalk, now: NOW });
		expect(out).toContain(chalk.green("API ok"));
		expect(out).toContain(chalk.red("FTP rejected"));
		expect(out).toContain(chalk.yellow("FTP unreachable"));
		expect(out).toContain(
			`${chalk.bold.cyan("shop")}${chalk.dim(" (default)")}`,
		);
	});
});

describe("relativeDay", () => {
	it.each([
		["2026-10-01T00:00:01.000Z", "today"],
		["2026-09-30T23:00:00.000Z", "yesterday"],
		["2026-09-21T10:00:00.000Z", "10 days ago"],
		["2026-06-01T10:00:00.000Z", "2026-06-01"],
		[null, "never"],
	])("%s → %s", (iso, expected) => {
		expect(relativeDay(iso, NOW)).toBe(expected);
	});
});

describe("displayPath", () => {
	it("shortens the home directory to ~", () => {
		expect(displayPath("/home/me/.config/x.json", "/home/me")).toBe(
			"~/.config/x.json",
		);
		expect(displayPath("/tmp/x.json", "/home/me")).toBe("/tmp/x.json");
	});
});
