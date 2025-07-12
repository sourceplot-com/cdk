import * as cdk from "aws-cdk-lib";
import { PipelineStack } from "./pipeline";
import { AWS_ACCOUNT_ID } from "./configuration/account";
import { AwsRegion } from "./model/region";

const app = new cdk.App();
const pipeline = new PipelineStack(app, "PipelineStack", {
	env: {
		account: AWS_ACCOUNT_ID,
		region: AwsRegion.US_EAST_1
	}
});
