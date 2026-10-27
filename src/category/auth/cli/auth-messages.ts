/**
 * Every auth message has the same shape: one plain sentence saying what
 * happened, then one line per way out, each naming the exact command.
 */
export function withNextSteps(what: string, ...steps: string[]): string {
	return [what, ...steps.map((step) => `  → ${step}`)].join("\n");
}
