import { describe, expect, it } from "vitest";
import {
	FormatTplScanProgressLine,
	TplScanProgressPercent,
} from "./tpl-scan-progress";

describe("tpl-scan-progress", () => {
	it("returns 100% when total is 0", () => {
		expect(TplScanProgressPercent(0, 0)).toBe(100);
	});

	it("rounds percent from done and total", () => {
		expect(TplScanProgressPercent(1, 2)).toBe(50);
		expect(TplScanProgressPercent(2, 2)).toBe(100);
		expect(TplScanProgressPercent(1, 3)).toBe(33);
	});

	it("format line includes bar and percent", () => {
		const line = FormatTplScanProgressLine(50, { width: 10 });
		expect(line).toContain("50%");
		expect(line).toContain("[");
	});
});
