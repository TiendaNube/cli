import os from "node:os";
import { Chalk, type ChalkInstance } from "chalk";
import type { AuthTokenKind } from "../domain/auth-credentials-types";
import type { CredentialStatus } from "../infra/auth-verify";

export type ListRowView = {
	alias: string;
	tokens: AuthTokenKind[];
	storeId: string | null;
	host: string | null;
	lastUsedAt: string | null;
	currentFolder: boolean;
	default: boolean;
	status?: Partial<Record<AuthTokenKind, CredentialStatus>>;
};

const KIND_LABEL: Record<AuthTokenKind, string> = { api: "API", ftp: "FTP" };

/** Color only for a color terminal: a pipe, a CI log or `NO_COLOR` gets plain text. */
export function terminalChalk(): ChalkInstance {
	const colored = process.stdout.isTTY === true && !process.env.NO_COLOR;
	return colored ? new Chalk() : new Chalk({ level: 0 });
}

export function relativeDay(iso: string | null, now: Date): string {
	if (iso === null) {
		return "never";
	}
	const then = Date.parse(iso);
	if (Number.isNaN(then)) {
		return "never";
	}
	const days = Math.floor(
		(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
			Date.UTC(
				new Date(then).getUTCFullYear(),
				new Date(then).getUTCMonth(),
				new Date(then).getUTCDate(),
			)) /
			86_400_000,
	);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 30) return `${days} days ago`;
	return iso.slice(0, 10);
}

/** `/Users/me/.config/x` → `~/.config/x`, for display only. */
export function displayPath(
	filePath: string,
	home: string = os.homedir(),
): string {
	return home !== "" && filePath.startsWith(home)
		? `~${filePath.slice(home.length)}`
		: filePath;
}

type Cell = { text: string; paint: (s: string) => string };

function credentialsCell(row: ListRowView, chalk: ChalkInstance): Cell {
	const parts = row.tokens.map((kind) => {
		const status = row.status?.[kind];
		const label = KIND_LABEL[kind];
		switch (status) {
			case "ok":
				return { text: `${label} ok`, painted: chalk.green(`${label} ok`) };
			case "rejected":
				return {
					text: `${label} rejected`,
					painted: chalk.red(`${label} rejected`),
				};
			case "unreachable":
				return {
					text: `${label} unreachable`,
					painted: chalk.yellow(`${label} unreachable`),
				};
			default:
				return { text: label, painted: label };
		}
	});
	const text = parts.map((part) => part.text).join(", ");
	const painted = parts.map((part) => part.painted).join(chalk.dim(", "));
	return { text, paint: () => painted };
}

/**
 * The `auth list` table. Widths come from the content, so nothing is cut;
 * color is applied after padding, so alignment never depends on escape codes.
 */
export function formatCredentialTable(
	rows: ListRowView[],
	options: { chalk: ChalkInstance; now: Date },
): string {
	const { chalk, now } = options;
	const plain = (s: string) => s;
	const header: Cell[] = ["ALIAS", "STORE", "CREDENTIALS", "LAST USED"].map(
		(text) => ({ text, paint: (s) => chalk.bold(s) }),
	);
	const body: Cell[][] = rows.map((row) => [
		{
			text: row.default ? `${row.alias} (default)` : row.alias,
			paint: () =>
				(row.currentFolder ? chalk.bold.cyan(row.alias) : row.alias) +
				(row.default ? chalk.dim(" (default)") : ""),
		},
		{
			text:
				[row.host ?? "", row.storeId !== null ? `#${row.storeId}` : ""]
					.filter((part) => part !== "")
					.join(" ") || "-",
			paint: (s) =>
				row.storeId !== null && row.host !== null
					? s.replace(`#${row.storeId}`, chalk.dim(`#${row.storeId}`))
					: s,
		},
		credentialsCell(row, chalk),
		{ text: relativeDay(row.lastUsedAt, now), paint: (s) => chalk.dim(s) },
	]);

	const widths = header.map((_, column) =>
		Math.max(
			...[header, ...body].map((cells) => cells[column]?.text.length ?? 0),
		),
	);
	const render = (cells: Cell[], marker: string): string =>
		[
			marker,
			...cells.map((cell, column) => {
				const padding = " ".repeat((widths[column] ?? 0) - cell.text.length);
				// The last column carries no trailing spaces.
				return column === cells.length - 1
					? cell.paint(cell.text)
					: `${cell.paint(cell.text)}${padding}`;
			}),
		].join("  ");

	return [
		render(header, " "),
		...body.map((cells, index) =>
			render(cells, rows[index]?.currentFolder ? chalk.cyan(">") : " "),
		),
	].join("\n");
}
