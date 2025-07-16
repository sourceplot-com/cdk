#!/usr/bin/env node
import { AWS_ACCOUNT_ID } from "./configuration/account";
import { AwsRegion } from "./model/region";
import { PipelineStack } from "./pipeline";
import * as cdk from "aws-cdk-lib";

const app = new cdk.App();
const pipeline = new PipelineStack(app, "SourcePlotPipelineStack", {
	env: {
		account: AWS_ACCOUNT_ID,
		region: AwsRegion.US_EAST_1
	}
});
