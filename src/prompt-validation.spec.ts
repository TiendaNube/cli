import { describe, expect, it } from "vitest";
import { composeValidators, required } from "./prompt-validation";

describe("required", () => {
	it("rejects empty and whitespace-only input", () => {
		const validate = required();
		expect(validate("")).toBeTruthy();
		expect(validate("   ")).toBeTruthy();
	});

	it("accepts non-empty input", () => {
		expect(required()("value")).toBeUndefined();
	});

	it("uses a custom message", () => {
		expect(required("nope")("")).toBe("nope");
	});
});

describe("composeValidators", () => {
	it("returns the first error in order", () => {
		const validate = composeValidators(
			(v) => (v.length < 2 ? "too short" : undefined),
			(v) => (v.includes("@") ? undefined : "needs @"),
		);
		expect(validate("a")).toBe("too short");
		expect(validate("ab")).toBe("needs @");
		expect(validate("a@b")).toBeUndefined();
	});

	it("accepts when all validators pass", () => {
		expect(composeValidators(required())("ok")).toBeUndefined();
	});
});
