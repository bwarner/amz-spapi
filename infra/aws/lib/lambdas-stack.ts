import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';
import { createAuth0Authorizer } from './auth0-authorizer.js';
import { discoverLambdaApps, type LambdaApp } from './lambda-apps.js';
import { LambdaHttpApi } from './lambda-http-api.js';
import { SyncWiring } from './sync-wiring.js';
import { ApiMonitoring } from './monitoring.js';

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
 *   image — a container built from the Dockerfile the build copied next to that
 *           bundle, for functions with native binaries or model files that
 *           cannot be bundled (ONNX, sharp), and the only way past 250MB
 *           unzipped.
 *
 * Both read the same directory, `dist/apps/lambdas/<name>`, and both identify
 * the deployed artefact by a hash of its contents — the zip through
 * `Code.fromAsset`, the image through `DockerImageCode.fromImageAsset`. That is
 * the whole reason there is no image tag, no version parameter and no push
 * target to keep in step: the template changes when, and only when, the built
 * output changes, which is exactly when CloudFormation must call
 * UpdateFunctionCode. A named tag cannot do this — Lambda resolves a tag to a
 * digest at deploy time and will not revisit it, so re-pushing `:latest` leaves
 * the old code running while the deploy reports success. See ADR-0006.
 *
 * Neither path uses the construct that bundles for you (`NodejsFunction`, or a
 * Dockerfile that compiles TypeScript): those build at synth time, outside Nx,
 * which would stop `nx affected` from governing what is deployed. Nx compiles;
 * CDK only packages what Nx produced.
 */
/** The alias every caller invokes. One name across every function and stage. */
export const LIVE_ALIAS = 'live';

export class LambdasStack extends Stack {
  /** The functions themselves. Use these for grants, metrics and alarms. */
  public readonly functions = new Map<string, lambda.Function>();
  /** What callers invoke. Route traffic here, never at the bare function. */
  public readonly aliases = new Map<string, lambda.Alias>();
  /** Alarms and the topic they publish to. Subscribe to the topic. */
  public readonly monitoring: ApiMonitoring;

  constructor(scope: Construct, id: string, props: LambdasStackProps) {
    super(scope, id, props);

    const { config, workspaceRoot } = props;
    const apps = discoverLambdaApps(workspaceRoot);

    for (const app of apps) {
      const fn =
        app.packaging === 'image'
          ? this.imageFunction(app, config, workspaceRoot)
          : this.zipFunction(app, config, workspaceRoot);

      this.functions.set(app.name, fn);

      // `$LATEST` is mutable and cannot be rolled back to — there is only ever
      // one of it, and deploying over it destroys what was there. Publishing a
      // version per change and pointing a fixed alias at it gives callers one
      // stable ARN, keeps the previous version invocable, and is the seam
      // CodeDeploy needs to shift traffic gradually rather than all at once
      // (CLAUDE.md §10). Callers never name a version, so this stays invisible
      // until the day it is needed.
      const alias = new lambda.Alias(this, `${pascal(app.name)}Alias`, {
        aliasName: LIVE_ALIAS,
        version: fn.currentVersion,
      });
      this.aliases.set(app.name, alias);

      new CfnOutput(this, `${pascal(app.name)}FunctionArn`, {
        // The alias, because that is what anything calling this should use.
        value: alias.functionArn,
        description: `${app.name} (${app.packaging}, alias ${LIVE_ALIAS})`,
      });
    }

    // Only when something asked to be reachable — an API with no routes is a
    // resource nobody can call, deployed on the chance that one day somebody
    // declares one.
    const httpApi = apps.some((app) => app.routes?.length)
      ? new LambdaHttpApi(this, 'HttpApi', {
          config,
          apps,
          targets: this.aliases,
          // Undefined until a stage has an Auth0 tenant configured, which the
          // API construct turns into a synth warning rather than a failure.
          authorizer: createAuth0Authorizer(config),
        })
      : undefined;

    // Watches real traffic rather than probing a synthetic endpoint — see the
    // construct, and ADR-0007 on why `/health` is not the uptime signal.
    this.monitoring = new ApiMonitoring(this, 'Monitoring', {
      config,
      api: httpApi?.api,
      targets: this.aliases,
    });

    new CfnOutput(this, 'AlarmTopicArn', {
      value: this.monitoring.topic.topicArn,
      description: 'Subscribe to be told when an alarm fires.',
    });

    new CfnOutput(this, 'DeployedLambdaCount', {
      value: String(apps.length),
      description: 'Lambda apps discovered under apps/lambdas.',
    });

    // Scheduled SP-API sync (#36). Lives here rather than in its own stack
    // because it both reads the functions' ARNs and writes to their roles and
    // environment — split across stacks that is a CloudFormation dependency
    // cycle, not a layering choice. See sync-wiring.ts.
    //
    // Conditional so a stage that has not deployed the sync apps gets no queue
    // and no schedule, rather than a schedule firing at a function that is not
    // there.
    const dispatcher = this.functions.get('sync-dispatcher');
    const worker = this.functions.get('sync-worker');
    if (dispatcher && worker) {
      new SyncWiring(this, 'Sync', {
        config: props.config,
        dispatcher,
        worker,
        alarmTopic: this.monitoring.topic,
      });
    }
  }

  private common(app: LambdaApp, config: StageConfig) {
    const functionName = `${config.appName}-${config.stageName}-${app.name}`;

    // Logs are the only way to see a Lambda that failed before it answered.
    // Without a retention policy they are kept forever and billed forever.
    //
    // Declared as a real LogGroup rather than the deprecated `logRetention`,
    // which is not just a rename: `logRetention` provisions a singleton custom
    // resource — its own Lambda, role and log group — whose only job is to call
    // PutRetentionPolicy after the fact. This owns the group outright, so the
    // retention is set at create time and there is no second function to deploy,
    // grant, or watch fail.
    const logGroup = new logs.LogGroup(this, `${pascal(app.name)}Logs`, {
      // Lambda writes here by convention. Deterministic because functionName is
      // explicit above — an auto-generated name would make this a cycle.
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      // CDK now owns the group, so tearing down a stage would take the logs of
      // whatever failed with it. Follows the same flag as the ECR repositories.
      removalPolicy: config.retainAssets
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
    });

    return {
      functionName,
      description: app.description,
      timeout: Duration.seconds(app.timeoutSeconds ?? 30),
      memorySize: app.memoryMb ?? 512,
      logGroup,
      environment: {
        SERVICE_NAME: app.name,
        STAGE: config.stageName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    };
  }

  /**
   * The built directory, or a failure naming the command that produces it.
   *
   * Synthesising against a stale or missing build would deploy whatever was
   * last on disk, or nothing at all.
   */
  private artefact(app: LambdaApp, workspaceRoot: string): string {
    const artefact = join(workspaceRoot, app.distPath);
    if (!existsSync(artefact)) {
      throw new Error(
        `Lambda "${app.name}" has no build output at ${app.distPath}. ` +
          `Run: nx build ${app.projectName}`
      );
    }
    return artefact;
  }

  private zipFunction(
    app: LambdaApp,
    config: StageConfig,
    workspaceRoot: string
  ): lambda.Function {
    return new lambda.Function(this, `${pascal(app.name)}Function`, {
      ...this.common(app, config),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: app.handler,
      code: lambda.Code.fromAsset(this.artefact(app, workspaceRoot)),
    });
  }

  private imageFunction(
    app: LambdaApp,
    config: StageConfig,
    workspaceRoot: string
  ): lambda.DockerImageFunction {
    const artefact = this.artefact(app, workspaceRoot);

    // The build context is the built output, so the asset hash covers exactly
    // what ships. That means the Dockerfile has to be in there too — Docker
    // cannot reach outside its context, and a context one directory up would
    // put unbuilt sources into the hash.
    if (!existsSync(join(artefact, 'Dockerfile'))) {
      throw new Error(
        `Lambda "${app.name}" is packaged as an image but ${app.distPath}/Dockerfile ` +
          `does not exist. Its build must copy the Dockerfile into the output — ` +
          `see apps/lambdas/README.md.`
      );
    }

    return new lambda.DockerImageFunction(this, `${pascal(app.name)}Function`, {
      ...this.common(app, config),
      code: lambda.DockerImageCode.fromImageAsset(artefact, {
        // Lambda runs x86-64 unless told otherwise, and the build machine is
        // arm64. Without this the image builds clean and fails on the first
        // invocation with an exec format error.
        platform: Platform.LINUX_AMD64,
        // Same `handler` declaration the zip path uses, so one line in
        // project.json governs both and no Dockerfile can disagree with it.
        cmd: [app.handler],
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
