import { Option } from "commander";

/**
 * `--alias <alias>` on a command that uses a credential: selects a stored
 * credential for this run only, ahead of the environment and of `.nuvem`.
 */
export function authAliasOption(): Option {
	return new Option(
		"--alias <alias>",
		"Use the stored credential with this alias for this run (see 'auth list')",
	);
}

/**
 * `--no-link` on a login: the credential is always stored, and the current
 * folder is linked to it unless this is given.
 */
export function noLinkOption(): Option {
	return new Option(
		"--no-link",
		"Store the credential without linking the current folder (no .nuvem is written)",
	);
}
