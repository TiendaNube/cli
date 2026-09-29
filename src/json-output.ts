import { Chalk, type ChalkInstance } from "chalk";

const JSON_TOKEN =
	/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function highlightJson(
	text: string,
	chalk: ChalkInstance = new Chalk(),
): string {
	return text.replace(
		JSON_TOKEN,
		(match, str: string | undefined, colon: string | undefined, bool) => {
			if (str !== undefined) {
				return colon !== undefined
					? `${chalk.cyan(str)}${colon}`
					: chalk.green(str);
			}
			if (bool !== undefined) return chalk.magenta(match);
			if (match === "null") return chalk.gray(match);
			return chalk.yellow(match);
		},
	);
}

function shouldHighlight(chalk: ChalkInstance): boolean {
	return (
		process.stdout.isTTY === true && !process.env.NO_COLOR && chalk.level > 0
	);
}

/** Writes JSON to stdout, highlighted only for a color terminal; pipes and CI get the text untouched. */
export function writeJsonOutput(
	text: string,
	chalk: ChalkInstance = new Chalk(),
): void {
	process.stdout.write(
		shouldHighlight(chalk) ? highlightJson(text, chalk) : text,
	);
}
