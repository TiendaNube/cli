import { describe, expect, it } from "vitest";
import {
	normalizeFtpServer,
	normalizeStoreUrl,
	validateStoreUrl,
} from "./theme-ftp-prompt-validators";

describe("normalizeStoreUrl", () => {
	it("prefixes https:// when the protocol is missing", () => {
		expect(normalizeStoreUrl("loja.com")).toBe("https://loja.com");
		expect(normalizeStoreUrl("  loja.com  ")).toBe("https://loja.com");
	});

	it("keeps an existing protocol", () => {
		expect(normalizeStoreUrl("http://loja.com")).toBe("http://loja.com");
		expect(normalizeStoreUrl("https://loja.com")).toBe("https://loja.com");
	});
});

describe("validateStoreUrl", () => {
	it("accepts values that normalize to a valid http/https URL", () => {
		expect(validateStoreUrl("loja.com")).toBeUndefined();
		expect(validateStoreUrl("https://loja.com")).toBeUndefined();
	});

	it("rejects values that cannot form a valid URL", () => {
		expect(validateStoreUrl("")).toBeTruthy();
		expect(validateStoreUrl("   ")).toBeTruthy();
	});
});

describe("normalizeFtpServer", () => {
	it("extracts host from a pasted URL", () => {
		expect(normalizeFtpServer("ftp://host.example.com/themes")).toBe(
			"host.example.com",
		);
		expect(normalizeFtpServer("http://host.example.com:21")).toBe(
			"host.example.com:21",
		);
	});

	it("strips a trailing path from a bare host", () => {
		expect(normalizeFtpServer("host.example.com/themes")).toBe(
			"host.example.com",
		);
	});

	it("keeps a plain host untouched", () => {
		expect(normalizeFtpServer("  host.example.com  ")).toBe("host.example.com");
	});
});
