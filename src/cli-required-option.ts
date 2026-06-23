import { type Command, Option } from "commander";
import { CliError } from "./cli-action";
import { CliInteraction } from "./cli-interaction";
import { isInteractive } from "./interactivity";
import {
	type PromptNormalizer,
	type PromptValidator,
	composeValidators,
	required,
} from "./prompt-validation";

type RequiredOptionSpec = {
	flags: string;
	long: string;
	attributeName: string;
	mask: boolean;
	validate?: PromptValidator;
	normalize?: PromptNormalizer;
};

const registry = new WeakMap<Command, RequiredOptionSpec[]>();

type ValidatableSpec = Pick<
	RequiredOptionSpec,
	"mask" | "validate" | "normalize"
>;

function buildValidator(spec: ValidatableSpec): PromptValidator {
	return composeValidators(
		required(),
		...(spec.validate ? [spec.validate] : []),
	);
}

/**
 * Prompts once with inline validation (clack re-prompts until valid or
 * cancelled) and returns the normalized value.
 */
async function promptValue(
	interaction: CliInteraction,
	label: string,
	spec: ValidatableSpec,
): Promise<string> {
	const validate = buildValidator(spec);
	const raw = spec.mask
		? await interaction.Password(label, { validate })
		: await interaction.Input(label, { validate });
	return spec.normalize ? spec.normalize(raw) : raw;
}

/**
 * Validates a value supplied via flag (non-interactive parity with prompts),
 * throwing `CliError` on failure, and returns the normalized value.
 */
function validateProvidedValue(spec: ValidatableSpec, value: string): string {
	const error = buildValidator(spec)(value);
	if (error) throw new CliError(error);
	return spec.normalize ? spec.normalize(value) : value;
}

async function promptMissingRequiredOptions(
	cmd: Command,
	specs: RequiredOptionSpec[],
): Promise<void> {
	const interaction = new CliInteraction();
	for (const spec of specs) {
		const current = cmd.getOptionValue(spec.attributeName);
		if (current !== undefined) {
			// Provided via flag: validate + normalize for parity with prompts.
			cmd.setOptionValue(
				spec.attributeName,
				validateProvidedValue(spec, String(current)),
			);
			continue;
		}

		if (!isInteractive(cmd)) {
			throw new CliError(`required option '${spec.flags}' not specified`);
		}

		const label = `Enter ${spec.long.replace(/^--/, "")}:`;
		cmd.setOptionValue(
			spec.attributeName,
			await promptValue(interaction, label, spec),
		);
	}
}

function ensureSpecsForCommand(cmd: Command): RequiredOptionSpec[] {
	const existing = registry.get(cmd);
	if (existing) return existing;
	const specs: RequiredOptionSpec[] = [];
	registry.set(cmd, specs);
	cmd.hook("preAction", async (_thisCmd, actionCmd) => {
		await promptMissingRequiredOptions(actionCmd, specs);
	});
	return specs;
}

export type AddRequiredOptionOpts = {
	mask?: boolean;
	validate?: PromptValidator;
	normalize?: PromptNormalizer;
};

/**
 * Prompt the user for a missing required value when interactive (TTY, not CI,
 * `--yes` absent), returning the validated/normalized answer. Outside an
 * interactive context returns `undefined` so the caller's existing error path
 * can fire unchanged in scripted/CI contexts. Pass `cmd` so `--yes` is honored.
 */
export async function promptForMissingValue(
	label: string,
	opts: AddRequiredOptionOpts = {},
	cmd?: Command,
): Promise<string | undefined> {
	if (!isInteractive(cmd)) return undefined;
	const interaction = new CliInteraction();
	return promptValue(interaction, label, {
		mask: opts.mask === true,
		validate: opts.validate,
		normalize: opts.normalize,
	});
}

/**
 * Register a required string option that prompts interactively when missing
 * in an interactive context, throwing a `CliError` otherwise (CI / `--yes`).
 * Optional `validate` runs inline in the prompt; `normalize` transforms the
 * accepted value.
 */
export function addRequiredOption(
	cmd: Command,
	flags: string,
	description: string,
	opts: AddRequiredOptionOpts = {},
): Command {
	const option = new Option(flags, description);
	cmd.addOption(option);
	const specs = ensureSpecsForCommand(cmd);
	specs.push({
		flags: option.flags,
		long: option.long ?? "",
		attributeName: option.attributeName(),
		mask: opts.mask === true,
		validate: opts.validate,
		normalize: opts.normalize,
	});
	return cmd;
}
