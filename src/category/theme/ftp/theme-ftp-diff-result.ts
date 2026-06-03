export type ThemeFtpDiffResult =
	| { success: false; errorMessage: string }
	| {
			success: true;
			toCreate: string[];
			toUpdate: string[];
			toDelete: string[];
			unchangedCount: number;
	  };
