import {
	ACTIVE_REPOSITORIES_PER_MESSAGE,
	LAMBDA_ALLOCATED_MEMORY,
	MESSAGES_TO_PROCESS_PER_LAMBDA,
	REPOSITORIES_TO_PROCESS_PER_LAMBDA,
	MESSAGES_TO_PROCESS_CONCURRENTLY
} from "../configuration/github";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { execFileSync } from "child_process";
import { Construct } from "constructs";
import { mkdirSync } from "fs";

export class GithubDataExtractorStack extends cdk.Stack {
	readonly activeRepoQueue: sqs.Queue;
	readonly activeRepoQueueDlq: sqs.Queue;

	readonly activeRepoExtractorLambda: lambda.Function;
	readonly repoAnalyzerLambda: lambda.Function;

	readonly scheduledExtractorInvoker: events.Rule;

	readonly repoDataTable: dynamodb.Table;
	readonly dailyStatsBucket: s3.Bucket;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		this.repoDataTable = new dynamodb.Table(this, "RepoDataTable", {
			tableName: "sourceplot-repo-data",
			partitionKey: {
				name: "repositoryName",
				type: dynamodb.AttributeType.STRING
			},
			readCapacity: 25,
			writeCapacity: 25,
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});
		this.dailyStatsBucket = new s3.Bucket(this, "DailyStatsBucket", {
			bucketName: "sourceplot-daily-stats",
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			versioned: false
		});

		this.activeRepoQueueDlq = new sqs.Queue(this, "ActiveRepoQueueDLQ", {
			queueName: "active-repo-queue-dlq",
			retentionPeriod: cdk.Duration.days(14),
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});
		this.activeRepoQueue = new sqs.Queue(this, "ActiveRepoQueue", {
			queueName: "active-repo-queue",
			visibilityTimeout: cdk.Duration.minutes(20),
			retentionPeriod: cdk.Duration.days(14),
			deadLetterQueue: {
				queue: this.activeRepoQueueDlq,
				maxReceiveCount: 3
			},
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});

		const activeRepoExtractorDir = "lambda-src/active-repo-extractor";
		if (process.env.NODE_ENV !== "production") {
			execFileSync("rm", ["-rf", activeRepoExtractorDir]);
			mkdirSync(activeRepoExtractorDir, { recursive: true });
			execFileSync("git", ["clone", "https://github.com/sourceplot-com/active-repo-extractor-lambda.git", activeRepoExtractorDir]);
		}

		this.activeRepoExtractorLambda = new lambda.Function(this, "ActiveRepoExtractorLambda", {
			functionName: "sourceplot-active-repo-extractor",
			runtime: lambda.Runtime.NODEJS_22_X,
			handler: "main.handler",
			timeout: cdk.Duration.seconds(30),
			architecture: lambda.Architecture.ARM_64,
			code: lambda.Code.fromAsset(activeRepoExtractorDir, {
				bundling: {
					image: lambda.Runtime.NODEJS_22_X.bundlingImage,
					command: ["/bin/bash", "-c", ["cd /asset-input", "npm install", "npm run package", "cp function.zip /asset-output/"].join(" && ")],
					outputType: cdk.BundlingOutput.ARCHIVED,
					user: "root"
				}
			}),
			environment: {
				ACTIVE_REPO_QUEUE_NAME: this.activeRepoQueue.queueName,
				ACTIVE_REPO_QUEUE_URL: this.activeRepoQueue.queueUrl,

				ACTIVE_REPOSITORIES_PER_MESSAGE: ACTIVE_REPOSITORIES_PER_MESSAGE.toString()
			}
		});
		this.activeRepoQueue.grantSendMessages(this.activeRepoExtractorLambda);
		this.scheduledExtractorInvoker = new events.Rule(this, "ExtractorCron", {
			ruleName: "sourceplot-active-repo-extractor-cron",
			schedule: events.Schedule.rate(cdk.Duration.hours(1)),
			enabled: false
		});
		this.scheduledExtractorInvoker.addTarget(new targets.LambdaFunction(this.activeRepoExtractorLambda));

		const repoAnalyzerDir = "lambda-src/repo-analyzer";
		if (process.env.NODE_ENV !== "production") {
			execFileSync("rm", ["-rf", repoAnalyzerDir]);
			mkdirSync(repoAnalyzerDir, { recursive: true });
			execFileSync("git", ["clone", "https://github.com/sourceplot-com/repo-analyzer-lambda.git", repoAnalyzerDir]);
		}

		this.repoAnalyzerLambda = new lambda.Function(this, "RepoAnalyzerLambda", {
			functionName: "sourceplot-repo-analyzer",
			runtime: lambda.Runtime.JAVA_21,
			handler: "com.sourceplot.handler.RepoAnalysisHandler::handleRequest",
			timeout: cdk.Duration.minutes(10),
			memorySize: LAMBDA_ALLOCATED_MEMORY,
			architecture: lambda.Architecture.ARM_64,
			code: lambda.Code.fromAsset(repoAnalyzerDir, {
				bundling: {
					image: lambda.Runtime.JAVA_21.bundlingImage,
					command: [
						"/bin/bash",
						"-c",
						["./gradlew shadowJar -x test --no-daemon --parallel --build-cache", "cp build/libs/*.jar /asset-output/"].join(" && ")
					],
					outputType: cdk.BundlingOutput.ARCHIVED,
					user: "root"
				}
			}),
			environment: {
				POWERTOOLS_SERVICE_NAME: "repo-analyzer",
				POWERTOOLS_METRICS_NAMESPACE: "sourceplot",

				REPO_DATA_TABLE_NAME: this.repoDataTable.tableName,

				ACTIVE_REPOSITORIES_PER_MESSAGE: ACTIVE_REPOSITORIES_PER_MESSAGE.toString(),
				REPOSITORIES_TO_PROCESS_PER_LAMBDA: REPOSITORIES_TO_PROCESS_PER_LAMBDA.toString(),
				MESSAGES_TO_PROCESS_PER_LAMBDA: MESSAGES_TO_PROCESS_PER_LAMBDA.toString(),
				MESSAGES_TO_PROCESS_CONCURRENTLY: MESSAGES_TO_PROCESS_CONCURRENTLY.toString()
			}
		});
		this.repoAnalyzerLambda.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"));
		this.repoAnalyzerLambda.addEventSource(
			new SqsEventSource(this.activeRepoQueue, {
				batchSize: MESSAGES_TO_PROCESS_PER_LAMBDA,
				maxBatchingWindow: cdk.Duration.seconds(5),
				reportBatchItemFailures: true
			})
		);
		this.activeRepoQueue.grantConsumeMessages(this.repoAnalyzerLambda);
		this.repoDataTable.grantReadWriteData(this.repoAnalyzerLambda);
		this.dailyStatsBucket.grantReadWrite(this.repoAnalyzerLambda);
	}
}
