import { AWS_ACCOUNT_ID } from "../configuration/account";
import { AwsRegion } from "../model/region";
import { Stack } from "../model/stack";
import { Stage } from "../model/stage";

export interface StageEnvironment {
	accountId: string;
	region: AwsRegion;
	stage: Stage;
	stacks: Stack[];
}

export const PIPELINE_STAGES: Partial<Record<Stage, StageEnvironment>> = {
	[Stage.PROD]: {
		accountId: AWS_ACCOUNT_ID,
		region: AwsRegion.US_EAST_1,
		stage: Stage.PROD,
		stacks: [Stack.GITHUB_DATA_EXTRACTOR, Stack.WEBSITE]
	}
};
