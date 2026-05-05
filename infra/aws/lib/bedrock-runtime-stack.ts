import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

export type BedrockRuntimeStackProps = cdk.StackProps & {
  config: StageConfig;
};

export class BedrockRuntimeStack extends Stack {
  public readonly runtimePolicy: iam.ManagedPolicy;
  public readonly runtimeRole?: iam.Role;

  constructor(scope: Construct, id: string, props: BedrockRuntimeStackProps) {
    super(scope, id, props);

    const { config } = props;
    const modelIds = [
      ...new Set([...config.bedrock.modelIds, config.bedrock.embeddingModelId]),
    ];

    this.runtimePolicy = new iam.ManagedPolicy(this, 'BedrockRuntimePolicy', {
      managedPolicyName: `${config.appName}-${config.stageName}-bedrock-runtime`,
      description:
        'Least-privilege permissions for SellAvant server-side Bedrock model calls.',
      statements: [
        new iam.PolicyStatement({
          sid: 'InvokeConfiguredBedrockModels',
          actions: [
            'bedrock:Converse',
            'bedrock:ConverseStream',
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
          ],
          resources: modelIds.flatMap((modelId) =>
            this.modelResourceArns(modelId)
          ),
        }),
      ],
    });

    if (
      config.bedrock.vercelOidcProviderArn &&
      config.bedrock.vercelOidcSubject
    ) {
      const issuerHost = issuerHostFromProviderArn(
        config.bedrock.vercelOidcProviderArn
      );

      this.runtimeRole = new iam.Role(this, 'BedrockRuntimeRole', {
        roleName: `${config.appName}-${config.stageName}-bedrock-runtime`,
        description:
          'Assumed by the SellAvant web runtime to call Amazon Bedrock.',
        assumedBy: new iam.FederatedPrincipal(
          config.bedrock.vercelOidcProviderArn,
          {
            StringEquals: {
              [`${issuerHost}:aud`]: config.bedrock.vercelOidcAudience || 'aws',
              [`${issuerHost}:sub`]: config.bedrock.vercelOidcSubject,
            },
          },
          'sts:AssumeRoleWithWebIdentity'
        ),
      });

      this.runtimeRole.addManagedPolicy(this.runtimePolicy);

      new CfnOutput(this, 'AwsBedrockRoleArn', {
        value: this.runtimeRole.roleArn,
        description: 'Set as AWS_BEDROCK_ROLE_ARN in the web app environment.',
      });
    }

    new CfnOutput(this, 'BedrockRuntimePolicyArn', {
      value: this.runtimePolicy.managedPolicyArn,
      description:
        'Attach this policy to the runtime principal that calls Amazon Bedrock.',
    });

    new CfnOutput(this, 'AiProvider', {
      value: 'bedrock',
      description: 'Set AI_PROVIDER=bedrock in production environments.',
    });

    new CfnOutput(this, 'BedrockEmbeddingModelId', {
      value: config.bedrock.embeddingModelId,
      description:
        'Embedding model allowed by the runtime policy for future retrieval features.',
    });
  }

  private modelResourceArns(modelId: string): string[] {
    const partition = cdk.Stack.of(this).partition;
    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    const arns = [
      `arn:${partition}:bedrock:${region}::foundation-model/${modelId}`,
      `arn:${partition}:bedrock:${region}:${account}:inference-profile/${modelId}`,
      `arn:${partition}:bedrock:${region}:${account}:application-inference-profile/${modelId}`,
    ];

    if (modelId.startsWith('us.')) {
      const foundationModelId = modelId.slice(3);
      arns.push(
        `arn:${partition}:bedrock:*::foundation-model/${foundationModelId}`
      );
    }

    return arns;
  }
}

function issuerHostFromProviderArn(providerArn: string): string {
  const marker = ':oidc-provider/';
  const markerIndex = providerArn.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `Invalid OIDC provider ARN "${providerArn}". Expected an arn ending with ${marker}<issuer>.`
    );
  }

  return providerArn.slice(markerIndex + marker.length);
}
