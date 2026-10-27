/** Which credential inside an identity: the Public API token or the FTP login. */
export type AuthTokenKind = "api" | "ftp";

export const AUTH_TOKEN_KINDS: readonly AuthTokenKind[] = ["api", "ftp"];

export type ApiToken = {
	accessToken: string;
	apiBaseUrl?: string;
};

export type FtpToken = {
	server: string;
	username: string;
	password: string;
};

export type StoreData = {
	/** Absent on FTP-only entries: the FTP flow never learns a store id. */
	storeId?: string;
	storeUrl?: string;
};

export type StoreTokens = {
	api?: ApiToken;
	ftp?: FtpToken;
};

/**
 * One alias in `credentials.json`. `type` is a field rather than a nesting
 * level so another kind of identity is a new value plus a validator, not a
 * schema migration. Everything that may be printed lives outside `tokens`.
 */
export type StoreIdentity = {
	alias: string;
	type: "store";
	createdAt: string;
	lastUsedAt?: string;
	data: StoreData;
	tokens: StoreTokens;
};

export type Identity = StoreIdentity;

export type CredentialsDocument = {
	configVersion: number;
	identities: Identity[];
	/**
	 * Used by a run that names no credential at all. Set by the first
	 * credential ever stored and by `auth default`; never picked again on its
	 * own once it is removed.
	 */
	defaultAlias?: string;
};
