import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class WebsiteStack extends cdk.Stack {
	readonly websiteBucket: s3.Bucket;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		this.websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
			bucketName: "sourceplot-website",
			removalPolicy: cdk.RemovalPolicy.DESTROY
		});
	}
}
