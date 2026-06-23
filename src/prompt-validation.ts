/** Returns an error message to keep prompting, or `undefined` to accept the value. */
export type PromptValidator = (value: string) => string | undefined;

/** Transforms an accepted value into its canonical stored form. */
export type PromptNormalizer = (value: string) => string;

/** Rejects empty / whitespace-only input. */
export function required(message = "This value is required."): PromptValidator {
	return (value) => (value.trim().length === 0 ? message : undefined);
}

/** Runs validators in order, returning the first error (or `undefined`). */
export function composeValidators(
	...validators: PromptValidator[]
): PromptValidator {
	return (value) => {
		for (const validator of validators) {
			const error = validator(value);
			if (error) return error;
		}
		return undefined;
	};
}
