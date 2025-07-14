import * as cdk from "aws-cdk-lib";
import * as pipelines from "aws-cdk-lib/pipelines";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { Construct } from "constructs";
import { PIPELINE_STAGES } from "./configuration/pipeline";
import { GithubDataExtractorStack } from "./stacks/github-data-extractor-stack";
import { Stack } from "./model/stack";
import { WebsiteStack } from "./stacks/website-stack";

const SOURCEPLOT_GITHUB_CONNECTION_ARN = "arn:aws:codeconnections:us-east-1:939880360164:connection/1bf27e6f-7e8c-4e06-a9f2-fb069d81a17a";

export class PipelineStack extends cdk.Stack {
	readonly pipeline: pipelines.CodePipeline;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		this.pipeline = this.createCodePipeline();
		this.addDeploymentStages();
	}

	private createCodePipeline() {
		const synth = new pipelines.ShellStep("Synth", {
			input: pipelines.CodePipelineSource.connection("sourceplot-com/cdk", "main", {
				connectionArn: SOURCEPLOT_GITHUB_CONNECTION_ARN
			}),
			commands: ["pwd", "ls -la", "npm ci", "npm run build", "npx cdk synth", "ls -la", "ls -la cdk.out"],
			primaryOutputDirectory: "cdk.out",
			env: {
				DOCKER_BUILDKIT: "1"
			}
		});

		return new pipelines.CodePipeline(this, "Pipeline", {
			dockerEnabledForSynth: true,
			usePipelineRoleForActions: true,
			pipelineName: "sourceplot-pipeline",
			synth,
			codeBuildDefaults: {
				buildEnvironment: {
					buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
					computeType: codebuild.ComputeType.SMALL,
					privileged: true
				}
			}
		});
	}

	private addDeploymentStages(): void {
		Object.entries(PIPELINE_STAGES).forEach(([stage, environment]) => {
			const pipelineStage = new cdk.Stage(this, `${stage}Stage`, {
				stageName: stage,
				env: {
					account: environment.accountId,
					region: environment.region
				}
			});

			environment.stacks.forEach((stack) => {
				switch (stack) {
					case Stack.GITHUB_DATA_EXTRACTOR:
						new GithubDataExtractorStack(pipelineStage, `Sourceplot${stack}Stack`);
						break;
					case Stack.WEBSITE:
						new WebsiteStack(pipelineStage, `Sourceplot${stack}Stack`);
						break;
				}
			});

			this.pipeline.addStage(pipelineStage);
		});
	}
}
