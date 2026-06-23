import type { PromptValidator } from "../../../prompt-validation";

/** Theme ids are numeric (used as-is in API URL paths). */
export const validateThemeId: PromptValidator = (value) =>
	/^\d+$/.test(value.trim())
		? undefined
		: "Theme id must be numeric (digits only).";

/** Catalog theme codes are lowercase slug-like identifiers (e.g. `ipanema`). */
export const validateBaseThemeCode: PromptValidator = (value) =>
	/^[a-z0-9_-]+$/.test(value.trim())
		? undefined
		: "Base theme code must be lowercase letters, digits, hyphens or underscores (e.g. ipanema).";

/** Base theme variants are letters only, starting with an uppercase letter (e.g. `Clothing`). */
export const validateBaseThemeVariant: PromptValidator = (value) =>
	/^[A-Z][a-zA-Z]*$/.test(value.trim())
		? undefined
		: "Base theme variant must contain only letters and start with an uppercase letter (e.g. Clothing).";
