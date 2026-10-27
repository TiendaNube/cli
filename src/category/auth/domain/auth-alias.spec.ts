import { describe, expect, it } from "vitest";
import {
	deriveAliasFromHost,
	storefrontHost,
	uniqueAlias,
	validateAlias,
} from "./auth-alias";
import type { Identity } from "./auth-credentials-types";

function entry(alias: string): Identity {
	return {
		alias,
		type: "store",
		createdAt: "2026-01-01T00:00:00.000Z",
		data: {},
		tokens: {},
	};
}

describe("auth aliases", () => {
	it.each([
		["acme.lojavirtualnuvem.com.br", "acme"],
		["www.Acme-Shop.com.br", "acme-shop"],
		["minha_loja.mitiendanube.com", "minha_loja"],
		["--weird--.example", "weird"],
		[undefined, "store"],
		["", "store"],
	])("derives %s → %s from the first host label", (host, expected) => {
		expect(deriveAliasFromHost(host)).toBe(expected);
	});

	it("reads the host of a storefront URL with or without a scheme", () => {
		expect(storefrontHost("https://Acme.Example/path")).toBe("acme.example");
		expect(storefrontHost("acme.example")).toBe("acme.example");
		expect(storefrontHost("")).toBeUndefined();
		expect(storefrontHost(undefined)).toBeUndefined();
	});

	it("suffixes an alias that is taken", () => {
		expect(uniqueAlias("acme", [])).toBe("acme");
		expect(uniqueAlias("acme", [entry("acme"), entry("acme-2")])).toBe(
			"acme-3",
		);
	});

	it("accepts the documented alphabet only", () => {
		expect(validateAlias("acme-2_shop.br")).toBeUndefined();
		expect(validateAlias("Acme")).toBeDefined();
		expect(validateAlias("-acme")).toBeDefined();
		expect(validateAlias("has space")).toBeDefined();
		expect(validateAlias("a".repeat(64))).toBeDefined();
	});
});
