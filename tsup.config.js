import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["./src/cli.ts"],
	clean: true,
	format: ["esm"],
	dts: false,
	outDir: "./dist",
	minify: false,
	sourcemap: true,
	define: {
		// Amplitude ingestion key, injected from the CircleCI context at publish
		// time. Only the variable *name* lives in source: this file and src/ are
		// mirrored verbatim to the public TiendaNube/cli repo, while the substituted
		// value only ever exists in CI and in dist/, which is gitignored and absent
		// from the mirror allowlist. An empty value leaves telemetry inert, which is
		// the expected state for local builds and public-repo clones.
		__TIENDANUBE_CLI_AMPLITUDE_API_KEY__: JSON.stringify(
			process.env.TIENDANUBE_CLI_AMPLITUDE_API_KEY ?? "",
		),
	},
	banner: {
		js: "#!/usr/bin/env node",
	},
});
