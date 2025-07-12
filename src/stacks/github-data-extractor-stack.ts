import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class GithubDataExtractorStack extends cdk.Stack {
	readonly repositoryQueue: sqs.Queue;
	readonly repositoryQueueDlq: sqs.Queue;
	readonly extractorLambda: lambda.Function;
	readonly repositoryLanguageStatsTable: dynamodb.TableV2;
	readonly dailyLanguageStatsTable: dynamodb.TableV2;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		this.repositoryLanguageStatsTable = new dynamodb.TableV2(this, "RepositoryLanguageStatsTable", {
			tableName: "repository-language-stats",
			partitionKey: { name: "repository", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});
		this.repositoryLanguageStatsTable.addGlobalSecondaryIndex({
			indexName: "DateIndex",
			partitionKey: { name: "date", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "repository", type: dynamodb.AttributeType.STRING }
		});
		this.dailyLanguageStatsTable = new dynamodb.TableV2(this, "DailyLanguageStatsTable", {
			tableName: "daily-language-stats",
			partitionKey: { name: "date", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});

		this.repositoryQueueDlq = new sqs.Queue(this, "RepositoryQueueDLQ", {
			queueName: "repository-queue-dlq",
			retentionPeriod: cdk.Duration.days(14),
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});
		this.repositoryQueue = new sqs.Queue(this, "RepositoryQueue", {
			queueName: "repository-queue",
			visibilityTimeout: cdk.Duration.minutes(15),
			retentionPeriod: cdk.Duration.days(14),
			deadLetterQueue: {
				queue: this.repositoryQueueDlq,
				maxReceiveCount: 3
			},
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});

		this.extractorLambda = new lambda.Function(this, "ExtractorLambda", {
			runtime: lambda.Runtime.JAVA_21,
			handler: "com.sourceplot.handler.RepositoryQueueHandler",
			code: lambda.Code.fromAsset(".", {
				bundling: {
					image: lambda.Runtime.JAVA_21.bundlingImage,
					command: [
						"/bin/bash",
						"-c",
						[
							"set -e",
							"echo 'Starting bundling process...'",
							"echo 'Current user: $(whoami)'",
							"echo 'Current uid: $(id -u)'",

							"microdnf update -y && microdnf install -y git",
							"echo 'Git installed successfully'",

							"mkdir -p /asset-output",
							"chmod 777 /asset-output",

							"git clone https://github.com/sourceplot-com/github-data-extractor.git /tmp/source",
							"cd /tmp/source",

							"./gradlew clean shadowJar -x test --info",

							"echo 'Searching for JAR files...'",
							"find . -name '*.jar' -type f -ls",

							"JAR_FILE=$(find . -name 'github-data-extractor-all.jar' -type f | head -1)",
							"echo 'Found JAR file: $JAR_FILE'",

							"if [ -n \"$JAR_FILE\" ]; then cp \"$JAR_FILE\" /asset-output/ && chmod 644 /asset-output/github-data-extractor-all.jar && echo 'JAR file copied successfully'; else echo 'ERROR: No JAR file found!' && exit 1; fi",

							"echo 'Final contents of /asset-output:'",
							"ls -la /asset-output/",
							"echo 'Bundling process completed'"
						].join(" && ")
					],
					outputType: cdk.BundlingOutput.ARCHIVED,
					user: "root"
				}
			}),
			environment: {
				REPOSITORY_LANGUAGE_STATS_TABLE: this.repositoryLanguageStatsTable.tableName,
				REPOSITORY_LANGUAGE_STATS_TABLE_DATE_INDEX: "DateIndex",
				DAILY_LANGUAGE_STATS_TABLE: this.dailyLanguageStatsTable.tableName
			}
		});
		this.extractorLambda.addEventSource(
			new SqsEventSource(this.repositoryQueue, {
				batchSize: 100,
				maxBatchingWindow: cdk.Duration.seconds(10),
				reportBatchItemFailures: true
			})
		);

		this.repositoryQueue.grantConsumeMessages(this.extractorLambda);
		this.repositoryLanguageStatsTable.grantReadWriteData(this.extractorLambda);
		this.dailyLanguageStatsTable.grantReadWriteData(this.extractorLambda);
	}
}
