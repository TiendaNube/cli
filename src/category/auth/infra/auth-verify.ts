import { fetchStorefrontUrlFromPublicApi } from "../../theme/api/theme-api-authorize-support";
import { resolveThemeApiBaseUrl } from "../../theme/api/theme-api-constants";
import { ThemeFtpClient } from "../../theme/ftp/theme-ftp-client";
import type { ApiToken, FtpToken } from "../domain/auth-credentials-types";

/**
 * `rejected` means the server answered and refused the credential (revoked
 * token, uninstalled app, changed password); `unreachable` means it could not
 * be asked, which says nothing about the credential itself.
 */
export type CredentialStatus = "ok" | "rejected" | "unreachable";

export type VerifyResult = { status: CredentialStatus; message?: string };

/** One `GET /store`: the cheapest call that proves the token still works. */
export async function verifyApiToken(params: {
	token: ApiToken;
	storeId: string;
	apiUrl?: string;
	extraHeaders?: Record<string, string>;
}): Promise<VerifyResult> {
	const result = await fetchStorefrontUrlFromPublicApi({
		apiBaseUrl: resolveThemeApiBaseUrl({
			configUrl: params.token.apiBaseUrl,
			cliUrl: params.apiUrl,
		}),
		storeId: params.storeId,
		accessToken: params.token.accessToken,
		extraHeaders: params.extraHeaders,
	});
	if (result.ok) {
		return { status: "ok" };
	}
	const rejected =
		result.httpStatus !== undefined &&
		result.httpStatus >= 400 &&
		result.httpStatus < 500;
	return {
		status: rejected ? "rejected" : "unreachable",
		message: result.message,
	};
}

/** A bare login over FTP; a 530 reply is a refused credential, anything else a transport failure. */
export async function verifyFtpToken(
	token: FtpToken,
	verbose = false,
): Promise<VerifyResult> {
	const result = await new ThemeFtpClient({
		ftpServer: token.server,
		ftpUsername: token.username,
		ftpPassword: token.password,
		verbose,
	}).Test();
	if (result.success) {
		return { status: "ok" };
	}
	const message = result.errorMessage ?? "FTP connection failed";
	return {
		status: /\b530\b|login|password|auth/i.test(message)
			? "rejected"
			: "unreachable",
		message,
	};
}
