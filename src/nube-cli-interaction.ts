import { Chalk } from "chalk";
import inquirer from "inquirer";

export class NubeCliInteraction {
	async Confirm(message: string): Promise<boolean> {
		const chalk = new Chalk();
		const answer = await inquirer.prompt([
			{
				type: "confirm",
				name: "confirm",
				message: chalk.green(message),
			},
		]);
		return answer.confirm;
	}

	async Input(message: string): Promise<string> {
		const chalk = new Chalk();
		const answer = await inquirer.prompt([
			{
				type: "input",
				name: "value",
				message: chalk.green(message),
			},
		]);
		return (answer.value as string).trim();
	}
}
