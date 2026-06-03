import crypto from "node:crypto";

export function phpJsonSerialize(content: unknown): string {
	return JSON.stringify(content)
		.replace(/\//g, "\\/")
		.replace(
			/[\u0080-\uffff]/g,
			(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
}

export function jsonContentHash(content: unknown): string {
	return crypto
		.createHash("md5")
		.update(phpJsonSerialize(content))
		.digest("hex");
}

export type ThemeDiffLocalFile = {
	path: string;
	full: string;
	format: string;
	content: unknown;
	hash: string;
};

export type ThemeDiffResult = {
	toCreate: ThemeDiffLocalFile[];
	toUpdate: ThemeDiffLocalFile[];
	toDelete: string[];
	unchanged: number;
};

export function computeThemeDiff(
	localFiles: ThemeDiffLocalFile[],
	remoteHashMap: Map<string, string>,
): ThemeDiffResult {
	const localPathSet = new Set(localFiles.map((f) => f.path));
	const toCreate: ThemeDiffLocalFile[] = [];
	const toUpdate: ThemeDiffLocalFile[] = [];
	let unchanged = 0;

	for (const file of localFiles) {
		const remoteHash = remoteHashMap.get(file.path);
		if (remoteHash === undefined) {
			toCreate.push(file);
		} else if (file.hash !== remoteHash) {
			toUpdate.push(file);
		} else {
			unchanged += 1;
		}
	}

	const toDelete = [...remoteHashMap.keys()].filter(
		(p) => !localPathSet.has(p),
	);

	return { toCreate, toUpdate, toDelete, unchanged };
}
