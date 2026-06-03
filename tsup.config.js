import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["./src/cli.ts"],
	clean: true,
	format: ["esm"],
	dts: false,
	outDir: "./dist",
	minify: false,
	sourcemap: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
});
