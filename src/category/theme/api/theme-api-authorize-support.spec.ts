import { describe, expect, it, vi } from "vitest";
import {
	decodeCliThemeAuthToken,
	ensureStorefrontProtocol,
	extractStorefrontUrlFromStoreJson,
	fetchStorefrontUrlFromPublicApi,
} from "./theme-api-authorize-support";

describe("ensureStorefrontProtocol", () => {
	it("prefixes https when scheme is missing", () => {
		expect(ensureStorefrontProtocol("shop.example.com")).toBe(
			"https://shop.example.com",
		);
	});

	it("leaves https URLs unchanged", () => {
		expect(ensureStorefrontProtocol("https://shop.example.com")).toBe(
			"https://shop.example.com",
		);
	});
});

describe("extractStorefrontUrlFromStoreJson", () => {
	const fixtureHost = "fixture-storefront.example.org";
	const fixtureHttps = `https://${fixtureHost}`;
	const sampleStore = {
		id: 9_080_701,
		url_with_protocol: fixtureHttps,
		original_domain: fixtureHost,
		domains: [],
	};

	it("prefers url_with_protocol", () => {
		expect(extractStorefrontUrlFromStoreJson(sampleStore)).toBe(fixtureHttps);
	});

	it("falls back to original_domain when url_with_protocol is missing", () => {
		expect(
			extractStorefrontUrlFromStoreJson({
				original_domain: fixtureHost,
			}),
		).toBe(fixtureHttps);
	});

	it("returns null when url_with_protocol is not a valid http(s) URL", () => {
		expect(
			extractStorefrontUrlFromStoreJson({
				url_with_protocol: "javascript:alert(1)",
				original_domain: "safe.example.com",
			}),
		).toBe("https://safe.example.com");
	});

	it("returns null for non-object bodies", () => {
		expect(extractStorefrontUrlFromStoreJson(null)).toBeNull();
		expect(extractStorefrontUrlFromStoreJson("x")).toBeNull();
	});
});

describe("decodeCliThemeAuthToken", () => {
	const payload = { store_id: 9_080_701, access_token: "tok123" };
	const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

	it("decodes a valid Base64 JSON payload", () => {
		const r = decodeCliThemeAuthToken(b64);
		expect(r).toEqual({
			ok: true,
			value: { storeId: "9080701", accessToken: "tok123" },
		});
	});

	it("accepts string store_id when numeric digits", () => {
		const raw = Buffer.from(
			JSON.stringify({ store_id: "42", access_token: "t" }),
			"utf8",
		).toString("base64");
		const r = decodeCliThemeAuthToken(raw);
		expect(r).toEqual({ ok: true, value: { storeId: "42", accessToken: "t" } });
	});

	it("rejects empty paste", () => {
		const r = decodeCliThemeAuthToken("  ");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.message).toContain("required");
		}
	});

	it("rejects invalid JSON after decode", () => {
		const bad = Buffer.from("not-json", "utf8").toString("base64");
		const r = decodeCliThemeAuthToken(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.message).toContain("JSON");
		}
	});

	it("rejects missing access_token", () => {
		const raw = Buffer.from(JSON.stringify({ store_id: 1 }), "utf8").toString(
			"base64",
		);
		const r = decodeCliThemeAuthToken(raw);
		expect(r.ok).toBe(false);
	});
});

describe("fetchStorefrontUrlFromPublicApi", () => {
	it("returns storeUrl on HTTP 200 with url_with_protocol", async () => {
		const storeUrl = "https://mock-api-store.example.test";
		const body = {
			url_with_protocol: storeUrl,
			original_domain: "mock-api-store.example.test",
		};
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => JSON.stringify(body),
		});

		const storeId = "7070102";
		const r = await fetchStorefrontUrlFromPublicApi({
			apiBaseUrl: "https://api.fixture-cli.example",
			storeId,
			accessToken: "secret",
			fetchFn: fetchFn as unknown as typeof fetch,
		});

		expect(r).toEqual({
			ok: true,
			storeUrl,
		});
		expect(fetchFn).toHaveBeenCalledWith(
			"https://api.fixture-cli.example/2025-03/7070102/store",
			expect.objectContaining({ method: "GET" }),
		);
		const callInit = fetchFn.mock.calls[0]?.[1] as { headers: Headers };
		expect(callInit.headers).toBeInstanceOf(Headers);
		expect(callInit.headers.get("Authentication")).toBe("bearer secret");
	});

	it("merges extraHeaders, allowing Authentication override", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					url_with_protocol: "https://store.example.test",
				}),
		});

		await fetchStorefrontUrlFromPublicApi({
			apiBaseUrl: "https://api.example",
			storeId: "1",
			accessToken: "from-token",
			extraHeaders: {
				"X-Trace-Id": "abc",
				authentication: "bearer override",
			},
			fetchFn: fetchFn as unknown as typeof fetch,
		});

		const callInit = fetchFn.mock.calls[0]?.[1] as { headers: Headers };
		expect(callInit.headers.get("X-Trace-Id")).toBe("abc");
		expect(callInit.headers.get("Authentication")).toBe("bearer override");
	});

	it("returns error on HTTP 401", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => JSON.stringify({ message: "Unauthorized" }),
		});

		const r = await fetchStorefrontUrlFromPublicApi({
			apiBaseUrl: "https://api.example.com",
			storeId: "1",
			accessToken: "x",
			fetchFn: fetchFn as unknown as typeof fetch,
		});

		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.message).toContain("401");
			expect(r.message).toContain("Unauthorized");
		}
	});
});
