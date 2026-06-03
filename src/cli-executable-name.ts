import path from "node:path";

/** Basename of the invoked CLI (tiendanube, nuvemshop, or node during tests). */
export function getCliExecutableName(): string {
	const argv1 = process.argv[1] ?? "";
	let base = path.basename(argv1);
	if (process.platform === "win32" && base.toLowerCase().endsWith(".cmd")) {
		base = base.slice(0, -".cmd".length);
	}
	if (base === "node" || base === "cli.js") {
		return "tiendanube";
	}
	return base || "tiendanube";
}
