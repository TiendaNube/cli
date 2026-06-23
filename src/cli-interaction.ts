import { confirm, isCancel, password, text } from "@clack/prompts";
import { CancelError } from "./cli-action";
import type { PromptValidator } from "./prompt-validation";

type PromptOpts = { validate?: PromptValidator };

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
		});
		if (isCancel(answer)) throw new CancelError();
		return (answer ?? "").trim();
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
