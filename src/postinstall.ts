import { detectInstalledAgents } from "./category/skills/skills-agents";

/**
 * Prints one suggestion after `npm i -g @tiendanube/cli`, when the machine has an
 * AI coding agent the bundled skills could serve.
 *
 * Four rules make this safe to run inside somebody's pipeline, and they are the
 * whole design:
 *
 * 1. **It never asks.** npm does not hand a terminal to a lifecycle script, so a
 *    prompt here does not appear and the install hangs waiting for it
 *    (npm/cli#2887). The real question is asked on the first interactive run —
 *    see `category/skills/skills-hint.ts`.
 * 2. **It never writes.** `sudo npm i -g` runs this as root, and a config file
 *    owned by root in somebody's home is not a mistake they can undo.
 * 3. **It never fails.** Everything is wrapped, and the exit code is always 0: a
 *    failing postinstall aborts the installation of a CLI that is otherwise fine.
 * 4. **It says nothing when nobody is watching** — no agents, or a CI run.
 *
 * Worth knowing about its reach: since npm 7 lifecycle output is hidden unless
 * `--foreground-scripts` is passed, and pnpm 10 does not run dependency lifecycle
 * scripts at all without an allowlist. This message is a bonus where it lands,
 * not the mechanism the feature relies on.
 */

/** Local copies so this entry point pulls in nothing but the agent table. */
function isTruthy(value: string | undefined): boolean {
	return (
		value !== undefined &&
		value !== "" &&
		value !== "0" &&
		value.toLowerCase() !== "false"
	);
}

export function buildPostinstallMessage(
	env: Record<string, string | undefined> = process.env,
	detect: typeof detectInstalledAgents = detectInstalledAgents,
): string | null {
	if (isTruthy(env.CI) || isTruthy(env.VITEST) || env.NODE_ENV === "test") {
		return null;
	}
	const agents = detect();
	if (agents.length === 0) {
		return null;
	}
	const names = agents.map((agent) => agent.displayName).join(", ");
	// `nuvemshop` rather than the resolved binary name: npm runs this through node,
	// so there is no invocation to mirror, and the brand follows the default.
	return [
		`Detected AI coding agents on this machine: ${names}.`,
		"Run `nuvemshop skills install` to teach them how Nuvemshop/Tiendanube themes work.",
	].join("\n");
}

export function runPostinstall(
	build: () => string | null = () => buildPostinstallMessage(),
): void {
	try {
		const message = build();
		if (message !== null) {
			process.stdout.write(`\n${message}\n`);
		}
	} catch {
		// Never let a suggestion break an install.
	}
}

runPostinstall();
