import { AWS_ACCOUNT_ID } from "./account";
import { AwsRegion } from "../model/region";
import { Stage } from "../model/stage";
import { Stack } from "../model/stack";

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
