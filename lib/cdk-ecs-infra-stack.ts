import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import { config } from "dotenv";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { RemovalPolicy } from "aws-cdk-lib";

config();

export class CdkEcsInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // Look up the default VPC
    const vpc = new ec2.Vpc(this, "LD-Relay-Proxy-VPC", {
      maxAzs: 3, // Default is all AZs in region
    });

    // only required if you are using HTTPS
    const certificate = Certificate.fromCertificateArn(
      this,
      "relay-proxy-cert",
      process.env.CERT_ARN || ""
    );

    const cluster = new ecs.Cluster(this, "ld-relay-proxy-cluster", { vpc });

    const flagsTable = new Table(this, "flags-table", {
      partitionKey: {
        name: "namespace",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "key",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "LD-Relay-Proxy-Service",
      {
        cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry("launchdarkly/ld-relay"),
          environment: {
            // include the Client Side ID in the env if you want your client side SDK to call the relay
            LD_CLIENT_SIDE_ID_Prod: process.env.LD_CLIENT_SIDE_ID_Prod || "",
            // indicating the environment
            LD_CLIENT_SIDE_ID_Staging:
              process.env.LD_CLIENT_SIDE_ID_Staging || "",
            // https://docs.launchdarkly.com/home/relay-proxy/deploying#deploying-the-relay-proxy
            LD_ENV_Staging: process.env.LD_ENV_Staging || "",
            LD_ENV_Prod: process.env.LD_ENV_Prod || "",
            // https://github.com/launchdarkly/ld-relay/blob/v6/docs/configuration.md
            DYNAMODB_TABLE: flagsTable.tableName,
            // boolean option to enable dynamo
            USE_DYNAMODB: "true",
            // if dynamo is enabled, you must either set a prefix for each LaunchDarkly env
            LD_PREFIX_Staging: process.env.LD_PREFIX_Staging || "",
            LD_PREFIX_Prod: process.env.LD_PREFIX_Prod || "",
            // or set table name by environment if you have separate tables
            // https://github.com/launchdarkly/ld-relay/blob/v6/docs/configuration.md#file-section-environment-name
            // LD_TABLE_NAME_Prod: 'Prod Table Name'
            // LD_TABLE_NAME_Staging: 'Staging Table Name'
          },
          containerPort: 8030,
          enableLogging: true,
        },
        desiredCount: 3,
        cpu: 4096,
        memoryLimitMiB: 16384,
        // certificate is only required if you want HTTPS
        certificate,
        // only applicable if you have a certificate
        redirectHTTP: true,
      }
    );

    flagsTable.grantReadWriteData(service.service.taskDefinition.taskRole);
  }
}
