import { Chalk } from "chalk";

export class NubeCliLogger {
	private chalk = new Chalk();

	Log(message: string) {
		console.log(this.chalk.green(message));
	}

	Error(message: string) {
		console.error(this.chalk.red(message));
	}

	Warn(message: string) {
		console.warn(this.chalk.yellow(message));
	}
}
