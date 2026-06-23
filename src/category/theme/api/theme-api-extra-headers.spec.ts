import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../cli-action";
import { CliLogger } from "../../../cli-logger";
import {
	parseExtraHeaderEntries,
	resolveExtraHeadersFromCli,
} from "./theme-api-extra-headers";

describe("parseExtraHeaderEntries", () => {
	it("parses Key: Value pairs and trims whitespace", () => {
		const result = parseExtraHeaderEntries(["X-Foo:   bar", "  X-Bar :baz  "]);
		expect(result.headers).toEqual({ "X-Foo": "bar", "X-Bar": "baz" });
		expect(result.authOverridden).toBe(false);
	});

	it("preserves colons inside the value", () => {
		const result = parseExtraHeaderEntries(["X-Trace: a:b:c"]);
		expect(result.headers).toEqual({ "X-Trace": "a:b:c" });
	});

	it("throws on entries without a colon", () => {
		expect(() => parseExtraHeaderEntries(["no-colon"])).toThrow(/Invalid/);
	});

	it("throws on entries with an empty key", () => {
		expect(() => parseExtraHeaderEntries([": value"])).toThrow(/Invalid/);
	});

	it("flags Authentication overrides case-insensitively", () => {
		const result = parseExtraHeaderEntries(["authentication: bearer xyz"]);
		expect(result.authOverridden).toBe(true);
		expect(result.headers).toEqual({ authentication: "bearer xyz" });
	});

	it("merges duplicate keys case-insensitively, keeping the last value and casing", () => {
		const result = parseExtraHeaderEntries(["X-Foo: first", "x-foo: second"]);
		expect(result.headers).toEqual({ "x-foo": "second" });
	});
});

describe("resolveExtraHeadersFromCli", () => {
	it("returns an empty record for missing or empty input", () => {
		const logger = new CliLogger();
		expect(resolveExtraHeadersFromCli(undefined, logger)).toEqual({});
		expect(resolveExtraHeadersFromCli([], logger)).toEqual({});
	});

	it("throws CliError when input is malformed", () => {
		const logger = new CliLogger();
		expect(() => resolveExtraHeadersFromCli(["broken"], logger)).toThrow(
			CliError,
		);
	});

	it("warns when Authentication is overridden", () => {
		const logger = new CliLogger();
		const warnSpy = vi.spyOn(logger, "Warn").mockImplementation(() => {});
		const result = resolveExtraHeadersFromCli(
			["Authentication: bearer x"],
			logger,
		);
		expect(result).toEqual({ Authentication: "bearer x" });
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it("does not warn for non-Authentication overrides", () => {
		const logger = new CliLogger();
		const warnSpy = vi.spyOn(logger, "Warn").mockImplementation(() => {});
		resolveExtraHeadersFromCli(["X-Trace: 123"], logger);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
