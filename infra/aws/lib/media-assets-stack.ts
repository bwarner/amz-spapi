import * as cdk from 'aws-cdk-lib';
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

export type MediaAssetsStackProps = cdk.StackProps & {
  config: StageConfig;
};

export class MediaAssetsStack extends Stack {
  public readonly assetBucket: s3.Bucket;
  public readonly runtimePolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: MediaAssetsStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainAssets
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
    const bucketName = [
      config.mediaBucketBaseName,
      config.stageName,
      this.account,
      this.region,
    ]
      .join('-')
      .toLowerCase();

    this.assetBucket = new s3.Bucket(this, 'MediaAssetBucket', {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !config.retainAssets,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.PUT,
          ],
          allowedOrigins: config.allowedOrigins,
          exposedHeaders: ['ETag', 'x-amz-request-id'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'ExpireIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: 'ExpireOldNoncurrentVersions',
          noncurrentVersionExpiration: cdk.Duration.days(
            config.noncurrentObjectExpirationDays
          ),
        },
      ],
    });

    const objectArn = this.assetBucket.arnForObjects('users/*/assets/*');

    this.runtimePolicy = new iam.ManagedPolicy(
      this,
      'MediaAssetsRuntimePolicy',
      {
        managedPolicyName: `${config.appName}-${config.stageName}-media-assets-runtime`,
        description:
          'Least-privilege permissions for SellAvant media asset presigned uploads and publish-time reads.',
        statements: [
          new iam.PolicyStatement({
            sid: 'ReadWriteMediaAssetObjects',
            actions: [
              's3:GetObject',
              's3:GetObjectTagging',
              's3:PutObject',
              's3:PutObjectTagging',
              's3:AbortMultipartUpload',
            ],
            resources: [objectArn],
          }),
          new iam.PolicyStatement({
            sid: 'ListMediaAssetPrefix',
            actions: ['s3:ListBucket'],
            resources: [this.assetBucket.bucketArn],
            conditions: {
              StringLike: {
                's3:prefix': ['users/*/assets/*'],
              },
            },
          }),
        ],
      }
    );

    new CfnOutput(this, 'MediaAssetsBucketName', {
      value: this.assetBucket.bucketName,
      description: 'Set as MEDIA_ASSETS_BUCKET in the web app environment.',
    });

    new CfnOutput(this, 'MediaAssetsRuntimePolicyArn', {
      value: this.runtimePolicy.managedPolicyArn,
      description:
        'Attach this policy to the runtime principal that signs/uploads media assets.',
    });

    new CfnOutput(this, 'WebEnvAwsRegion', {
      value: this.region,
      description: 'Set as AWS_REGION in the web app environment.',
    });
  }
}
