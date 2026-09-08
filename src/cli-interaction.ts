import { confirm, isCancel, password, select, text } from "@clack/prompts";
import { CancelError } from "./cli-action";
import type { PromptValidator } from "./prompt-validation";

type PromptOpts = {
	validate?: PromptValidator;
	initialValue?: string;
};

function toClackValidate(validate?: PromptValidator) {
	return validate
		? (value: string | undefined) => validate(String(value ?? ""))
		: undefined;
}

export class CliInteraction {
	async Confirm(message: string): Promise<boolean> {
		const answer = await confirm({ message });
		if (isCancel(answer)) throw new CancelError();
		return answer;
	}

	async Input(message: string, opts: PromptOpts = {}): Promise<string> {
		const answer = await text({
			message,
			validate: toClackValidate(opts.validate),
			initialValue: opts.initialValue,
		});
		if (isCancel(answer)) throw new CancelError();
		return (answer ?? "").trim();
	}

	/**
	 * Pick one of a known set of values. Preferred over `Input` with a validator
	 * whenever the valid answers are already known — the user cannot mistype, and
	 * they see what is on offer instead of guessing at a format.
	 */
	async Select(
		message: string,
		options: Array<{ value: string; label?: string; hint?: string }>,
	): Promise<string> {
		const answer = await select({
			message,
			options: options.map((o) => ({
				value: o.value,
				label: o.label ?? o.value,
				...(o.hint !== undefined ? { hint: o.hint } : {}),
			})),
		});
		if (isCancel(answer)) throw new CancelError();
		return String(answer);
	}

	async Password(message: string, opts: PromptOpts = {}): Promise<string> {
		const answer = await password({
			message,
			mask: "*",
			validate: toClackValidate(opts.validate),
		});
		if (isCancel(answer)) throw new CancelError();
		return (answer ?? "").trim();
	}
}
