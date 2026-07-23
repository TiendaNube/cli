import lighthouse, { desktopConfig } from "lighthouse";
import puppeteer from "puppeteer";
import {
	PERFORMANCE_DEVICES,
	type PerformanceDevice,
} from "./theme-api-performance-report";

/**
 * Lighthouse flags shared by every pass: connect to the already-running
 * Puppeteer Chrome via its debugging `port`, audit only the performance
 * category, and stay quiet so the flag output does not pollute stdout.
 */
const PERFORMANCE_LIGHTHOUSE_FLAGS = {
	logLevel: "error" as const,
	output: "json" as const,
	onlyCategories: ["performance"],
};

export type DevicePerformanceResult = {
	device: PerformanceDevice;
	/** Raw Lighthouse Result (`lhr`) for this form factor. */
	lhr: unknown;
};

async function runReportedAudit(
	url: string,
	flags: typeof PERFORMANCE_LIGHTHOUSE_FLAGS & { port: number },
	config?: Parameters<typeof lighthouse>[2],
): Promise<unknown> {
	const result = await lighthouse(url, flags, config);
	if (!result?.lhr) {
		throw new Error(
			`Lighthouse did not return a result for ${url}. The storefront may be unreachable.`,
		);
	}
	return result.lhr;
}

/**
 * Launches a headless Chrome (bundled with Puppeteer) and audits `url` with
 * Lighthouse for each requested form factor (defaults to mobile and desktop),
 * returning one raw Lighthouse Result (`lhr`) per device in the requested order.
 *
 * The storefront is warmed up once before any reported run. Hitting it cold can
 * trigger server-side template compilation and edge/CDN caching, which is
 * device-independent and would otherwise penalize whichever run happened to go
 * first. That warm-up pass is discarded; only the subsequent per-device runs are
 * returned and reported to the user.
 */
export async function runThemePerformanceAudits(
	url: string,
	devices: readonly PerformanceDevice[] = PERFORMANCE_DEVICES,
): Promise<DevicePerformanceResult[]> {
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-gpu"],
	});
	try {
		const port = Number(new URL(browser.wsEndpoint()).port);
		const flags = { ...PERFORMANCE_LIGHTHOUSE_FLAGS, port };

		// Warm-up pass — deliberately ignored, see the function doc above.
		await lighthouse(url, flags);

		// Reported passes. Mobile uses Lighthouse's default form factor; desktop
		// uses the bundled desktop preset (1350x940, desktop UA, faster throttling).
		const results: DevicePerformanceResult[] = [];
		for (const device of devices) {
			const config = device === "desktop" ? desktopConfig : undefined;
			results.push({ device, lhr: await runReportedAudit(url, flags, config) });
		}
		return results;
	} finally {
		try {
			await browser.close();
		} catch {
			// ignore secondary close errors
		}
	}
}
