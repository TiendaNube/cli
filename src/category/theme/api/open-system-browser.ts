import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Opens `url` in the system default browser (macOS, Linux, Windows).
 * Caller must validate the URL (e.g. only http/https) before invoking.
 */
export function openSystemBrowser(url: string): void {
	const platform = process.platform;
	let child: ReturnType<typeof spawn>;
	if (platform === "win32") {
		const comSpec = process.env.ComSpec ?? "cmd.exe";
		child = spawn(comSpec, ["/c", "start", "", url], {
			detached: true,
			stdio: "ignore",
			shell: false,
		});
	} else if (platform === "darwin") {
		child = spawn("open", [url], {
			detached: true,
			stdio: "ignore",
			shell: false,
		});
	} else {
		child = spawn("xdg-open", [url], {
			detached: true,
			stdio: "ignore",
			shell: false,
		});
	}
	child.unref();
}
