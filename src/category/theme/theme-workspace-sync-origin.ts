import { getCliExecutableName } from "../../cli-executable-name";
import type { ThemeSyncFamily } from "./theme-workspace-types";

const FAMILY_LABEL: Record<ThemeSyncFamily, string> = {
	api: "Public API",
	ftp: "FTP",
};

const PULL_COMMAND: Record<ThemeSyncFamily, string> = {
	api: "theme pull",
	ftp: "theme ftp pull",
};

/**
 * A workspace can hold both credential families, so the local files may have come
 * from either one. Uploading a tree pulled by the other family sends, for example,
 * a sections-based theme to a classic one — so the push commands refuse it.
 *
 * Returns the refusal message, or `null` when the push may proceed:
 * - no origin recorded (every pre-existing workspace, and anything cloned from
 *   git) — unknown is not the same as wrong, so it is allowed;
 * - origin matches the family being pushed to.
 */
export function crossFamilyPushRefusal(params: {
	target: ThemeSyncFamily;
	lastSync: ThemeSyncFamily | undefined;
}): string | null {
	const { target, lastSync } = params;
	if (lastSync === undefined || lastSync === target) {
		return null;
	}
	const bin = getCliExecutableName();
	return `Local files were last pulled over ${FAMILY_LABEL[lastSync]}, and this would upload them over ${FAMILY_LABEL[target]}. Run ${bin} ${PULL_COMMAND[target]} first, or pass --force to upload them anyway.`;
}

/** Same check for the watch commands, which push on every save and take no --force. */
export function crossFamilyWatchRefusal(params: {
	target: ThemeSyncFamily;
	lastSync: ThemeSyncFamily | undefined;
}): string | null {
	const { target, lastSync } = params;
	if (lastSync === undefined || lastSync === target) {
		return null;
	}
	const bin = getCliExecutableName();
	return `Local files were last pulled over ${FAMILY_LABEL[lastSync]}, so watching would upload them over ${FAMILY_LABEL[target]} on every save. Run ${bin} ${PULL_COMMAND[target]} first.`;
}

/** Extra line for a push confirmation, so --force never bypasses this silently. */
export function crossFamilyForcedNotice(params: {
	target: ThemeSyncFamily;
	lastSync: ThemeSyncFamily | undefined;
}): string {
	const { target, lastSync } = params;
	if (lastSync === undefined || lastSync === target) {
		return "";
	}
	return ` NOTE: these files were last pulled over ${FAMILY_LABEL[lastSync]} and --force is uploading them over ${FAMILY_LABEL[target]}.`;
}
