import fs from "node:fs";
import path from "node:path";

export type ThemeFileFormat = "json" | "text" | "base64";

export function getThemeFileFormat(filePath: string): ThemeFileFormat {
	const normalized = filePath.replace(/\\/g, "/");
	if (normalized.endsWith(".json")) {
		return "json";
	}
	if (
		normalized.endsWith(".tpl") ||
		normalized.endsWith(".css") ||
		normalized.endsWith(".js") ||
		normalized.endsWith(".svg")
	) {
		return "text";
	}
	return "base64";
}

export function readThemeFileContent(
	absolutePath: string,
	format: ThemeFileFormat,
): unknown {
	switch (format) {
		case "json":
			return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
		case "text":
			return fs.readFileSync(absolutePath, "utf8");
		case "base64":
			return fs.readFileSync(absolutePath).toString("base64");
		default: {
			const _exhaustive: never = format;
			return _exhaustive;
		}
	}
}

export function decodeRemoteFileContent(
	content: unknown,
	format: string,
): string | Buffer {
	switch (format) {
		case "json":
			return `${JSON.stringify(content, null, 2)}\n`;
		case "text":
			return typeof content === "string" ? content : String(content);
		case "base64":
			if (typeof content !== "string") {
				throw new Error("Expected base64 string in file content");
			}
			return Buffer.from(content, "base64");
		default:
			return typeof content === "string" ? content : String(content);
	}
}

export function isPathInsideThemeRoot(
	themeRoot: string,
	relativePath: string,
): boolean {
	const resolved = path.resolve(themeRoot, relativePath);
	const rootResolved = path.resolve(themeRoot);
	return (
		resolved === rootResolved ||
		resolved.startsWith(`${rootResolved}${path.sep}`)
	);
}
