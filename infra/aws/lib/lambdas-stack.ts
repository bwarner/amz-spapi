import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';
import { discoverLambdaApps, type LambdaApp } from './lambda-apps.js';

export type LambdasStackProps = cdk.StackProps & {
  config: StageConfig;
  /** Absolute path to the workspace root; artefacts are resolved from it. */
  workspaceRoot: string;
};

/**
 * Every Lambda app in the workspace, deployed the way it asked to be (#53).
 *
 * Two packaging paths, chosen per app by its own declaration rather than by a
 * list kept here:
 *
 *   zip   — an esbuild bundle from `nx build`. No node_modules is shipped;
 *           pnpm's linked layout does not survive packaging, and bundling makes
 *           workspace-dependency resolution a non-issue at runtime.
 *   image — a container built from the app's Dockerfile and pushed to ECR, for
 *           functions with native binaries or model files that cannot be
 *           bundled (ONNX, sharp), and the only way past 250MB unzipped.
 *
 * The zip path deliberately uses `Code.fromAsset` over the built output rather
 * than `NodejsFunction`: that construct bundles with its own esbuild at synth
 * time, which would rebuild the code outside Nx and stop `nx affected` from
 * governing what is deployed.
 */
export class LambdasStack extends Stack {
  public readonly functions = new Map<string, lambda.IFunction>();
  public readonly repositories = new Map<string, ecr.Repository>();

  constructor(scope: Construct, id: string, props: LambdasStackProps) {
    super(scope, id, props);

    const { config, workspaceRoot } = props;
    const apps = discoverLambdaApps(workspaceRoot);

    for (const app of apps) {
      const fn =
        app.packaging === 'image'
          ? this.imageFunction(app, config)
          : this.zipFunction(app, config, workspaceRoot);

      this.functions.set(app.name, fn);

      new CfnOutput(this, `${pascal(app.name)}FunctionArn`, {
        value: fn.functionArn,
        description: `${app.name} (${app.packaging})`,
      });
    }

    new CfnOutput(this, 'DeployedLambdaCount', {
      value: String(apps.length),
      description: 'Lambda apps discovered under apps/lambdas.',
    });
  }

  private common(app: LambdaApp, config: StageConfig) {
    return {
      functionName: `${config.appName}-${config.stageName}-${app.name}`,
      description: app.description,
      timeout: Duration.seconds(app.timeoutSeconds ?? 30),
      memorySize: app.memoryMb ?? 512,
      // Logs are the only way to see a Lambda that failed before it answered.
      // Without a retention policy they are kept forever and billed forever.
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        SERVICE_NAME: app.name,
        STAGE: config.stageName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    };
  }

  private zipFunction(
    app: LambdaApp,
    config: StageConfig,
    workspaceRoot: string
  ): lambda.Function {
    const artefact = join(workspaceRoot, app.distPath);
    if (!existsSync(artefact)) {
      // Synthesising against a stale or missing build would deploy whatever was
      // last there, or nothing. Say which command produces it.
      throw new Error(
        `Lambda "${app.name}" has no build output at ${app.distPath}. ` +
          `Run: nx build ${app.projectName}`
      );
    }

    return new lambda.Function(this, `${pascal(app.name)}Function`, {
      ...this.common(app, config),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: app.handler,
      code: lambda.Code.fromAsset(artefact),
    });
  }

  private imageFunction(
    app: LambdaApp,
    config: StageConfig
  ): lambda.DockerImageFunction {
    // One repository per function, so a rollback is per-function and image
    // lifecycle rules do not evict another function's last good image.
    const repository = new ecr.Repository(this, `${pascal(app.name)}Repo`, {
      repositoryName: `${config.appName}/${config.stageName}/${app.name}`,
      imageScanOnPush: true,
      removalPolicy: config.retainAssets
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      lifecycleRules: [
        { maxImageCount: 10, description: 'Keep the last ten images.' },
      ],
    });
    this.repositories.set(app.name, repository);

    const { handler: _handler, ...common } = {
      ...this.common(app, config),
      handler: app.handler,
    };

    return new lambda.DockerImageFunction(this, `${pascal(app.name)}Function`, {
      ...common,
      // The tag is pushed by the app's `push` target. `latest` is deliberate
      // for now and wrong later: pin to the commit sha once CI does the push,
      // or a redeploy cannot be reproduced.
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: 'latest',
      }),
    });
  }
}

function pascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
