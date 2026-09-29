export type ThemeFtpDiffResult =
	| { success: false; errorMessage: string }
	| {
			success: true;
			toCreate: string[];
			toUpdate: string[];
			toDelete: string[];
			/** Zero-byte local files that would otherwise be uploaded; upload skips them. */
			skippedEmpty: string[];
			unchangedCount: number;
	  };
