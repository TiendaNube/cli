import fs from "node:fs";
import { getCliExecutableName } from "../../../cli-executable-name";
import { NubeCliInteraction } from "../../../nube-cli-interaction";
import { NubeCliLogger } from "../../../nube-cli-logger";
import { ThemeWorkspaceConfigManager } from "../theme-workspace-config-manager";
import { ThemeApiClient } from "./theme-api-client";
import {
	normalizeApiBaseUrl,
	resolveThemeApiBaseUrl,
} from "./theme-api-constants";

export type SetupParams = {
	token: string;
	storeId: string;
	storeUrl: string;
	apiUrl?: string;
	extraHeaders?: Record<string, string>;
	skipConfirm: boolean;
	verbose: boolean;
};

export async function executeThemeApiSetup(
	params: SetupParams,
): Promise<boolean> {
	const logger = new NubeCliLogger();
	const interaction = new NubeCliInteraction();
	const workspace = new ThemeWorkspaceConfigManager();

	const files = fs.readdirSync(".");
	if (files.length > 0 && !params.skipConfirm) {
		const confirm = await interaction.Confirm(
			"We recommend running setup in an empty directory so the theme workspace remains isolated from unrelated files. This directory is not empty; you may still proceed if that is intentional. Do you want to continue with setup?",
		);
		if (!confirm) {
			logger.Error("Setup aborted.");
			return false;
		}
	}

	const token = params.token.trim();
	const storeId = params.storeId.trim();
	const storeUrl = params.storeUrl.trim();
	if (!token || !storeId) {
		logger.Error("Token and store id must be non-empty.");
		return false;
	}
	if (!storeUrl) {
		logger.Error("Store URL must be non-empty.");
		return false;
	}
	try {
		const parsed = new URL(storeUrl);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			logger.Error(
				`Store URL must use http or https (got ${parsed.protocol}).`,
			);
			return false;
		}
	} catch {
		logger.Error(
			"--store-url must be a valid absolute storefront URL (e.g. https://your-store.lojavirtualnuvem.com.br).",
		);
		return false;
	}

	const doc = workspace.IsSet() ? workspace.readWorkspace() : {};
	const prevApi = doc["theme-api"];

	const nextApi = {
		...prevApi,
		publicApiToken: token,
		storeId,
		storeUrl,
		...(params.apiUrl !== undefined && params.apiUrl.trim() !== ""
			? { apiBaseUrl: normalizeApiBaseUrl(params.apiUrl) }
			: {}),
	};

	workspace.mergeWorkspace({
		themeManagement: "api",
		"theme-api": nextApi,
	});

	logger.Log("Verifying API access…");
	const baseUrl = resolveThemeApiBaseUrl({
		configUrl: nextApi.apiBaseUrl,
		cliUrl: undefined,
	});
	try {
		const client = new ThemeApiClient({
			apiBaseUrl: baseUrl,
			publicApiToken: token,
			storeId,
			verbose: params.verbose,
			extraHeaders: params.extraHeaders,
		});
		await client.listInstallations();
		logger.Log("API credentials verified.");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.Error(
			`API verification failed: ${msg}. Configuration was saved; check token, store id, and theme-api.apiBaseUrl in .nuvem if using a non-default API host.`,
		);
		return false;
	}

	const cli = getCliExecutableName();
	logger.Log(
		`Store configuration saved. Use ${cli} theme list|create|clone|publish|fork|delete|preview|current and ${cli} theme pull|push|watch.`,
	);
	return true;
}
