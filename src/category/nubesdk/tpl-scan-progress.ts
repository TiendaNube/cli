/** Percent 0–100 from files read vs total `.tpl` files (100 if total is 0). */
export function TplScanProgressPercent(done: number, total: number): number {
	if (total === 0) {
		return 100;
	}
	return Math.round((done / total) * 100);
}

export function FormatTplScanProgressLine(
	percent: number,
	options?: { width?: number; label?: string },
): string {
	const width = options?.width ?? 28;
	const filled = Math.round((percent / 100) * width);
	const bar = "#".repeat(filled) + "-".repeat(Math.max(0, width - filled));
	const label = options?.label ?? "Reading .tpl";
	return `${label} [${bar}] ${percent}%`;
}
