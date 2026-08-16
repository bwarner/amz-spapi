import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';
import { createAuth0Authorizer } from './auth0-authorizer.js';
import {
  credentialsKeyAlias,
  credentialsKeyExportName,
} from './credentials-key-stack.js';
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

  private readonly stageConfig: StageConfig;

  constructor(scope: Construct, id: string, props: LambdasStackProps) {
    super(scope, id, props);

    const { config, workspaceRoot } = props;
    // Held so the lazy resource getters below do not each need it threaded
    // through; they are called from the loop, not from the constructor.
    this.stageConfig = config;
    const apps = discoverLambdaApps(workspaceRoot);

    for (const app of apps) {
      const fn =
        app.packaging === 'image'
          ? this.imageFunction(app, config, workspaceRoot)
          : this.zipFunction(app, config, workspaceRoot);

      this.functions.set(app.name, fn);

      // Only apps that declared it. The Couchbase user's permissions are
      // scope-wide (ADR-0005), so a grant here lets the function read every
      // collection in the environment — including `credentials_profiles`.
      // Throws when the stage has no Couchbase configured, which fails the
      // synth rather than deploying a function guaranteed to error on its first
      // request. Unlike the Auth0 case, which warns: an unauthenticated route
      // still functions, an unconfigured Couchbase Lambda cannot.
      if (app.couchbase) {
        this.couchbaseSecret(config).grantRead(fn);
      }

      // The heaviest grant in the workspace: together these turn a stored blob
      // into an access token for a seller's Amazon account (#55). Exactly one
      // function declares it, and the whole of the credential slice's security
      // argument is that no other runtime holds both halves.
      if (app.amazonCredentials) {
        this.amazonOauthSecret(config).grantRead(fn);
        this.credentialsKey().grant(
          fn,
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:DescribeKey',
          'kms:GenerateDataKey'
        );
      }

      // Its own machine identity, and nothing of the seller's (#152). No KMS
      // grant and no Amazon OAuth secret: this function can ask for a token for
      // a named seller, and cannot produce one itself.
      if (app.callsCredentialService) {
        this.auth0ServicePrincipalSecret(config).grantRead(fn);
      }

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

    this.wireCredentialServiceCallers(apps, httpApi?.api.apiEndpoint);

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

    // Named in the deploy output because `fromSecretNameV2` does not check that
    // the secret exists — a missing one fails at the first invocation, not at
    // deploy. Printing what the stack expects turns that into something the
    // operator can check before finding out from a 500.
    if (apps.some((app) => app.couchbase) && config.couchbase) {
      new CfnOutput(this, 'CouchbaseSecretName', {
        value: config.couchbase.secretName,
        description:
          'Secrets Manager secret holding {"username","password"}. Must exist.',
      });
    }

    if (apps.some((app) => app.amazonCredentials) && config.amazonOauth) {
      new CfnOutput(this, 'AmazonOauthSecretName', {
        value: config.amazonOauth.secretName,
        description:
          'Secrets Manager secret holding the LWA and Ads client id/secret. ' +
          'Must exist — create it with scripts/amazon-oauth-secret.sh.',
      });
    }

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

  /**
   * The Couchbase login, referenced rather than created (#55).
   *
   * `fromSecretNameV2` because CDK must never hold this value: creating the
   * secret would mean either a generated string that is wrong and has to be
   * overwritten by hand — indistinguishable from a real one until the first
   * 401 — or the real password inside the template. It would also put a shared
   * cluster credential inside the blast radius of a stack teardown. Created out
   * of band once per stage; see `docs/deployment-environment.md`.
   *
   * By NAME rather than ARN so it survives the secret being recreated, which
   * changes the random six-character ARN suffix. The cost is that `grantRead`
   * scopes to `…:secret:<name>-??????` and that existence is not checked at
   * synth — a missing secret fails on first invocation, which the deploy
   * checklist covers.
   *
   * Built lazily and once: constructing it per function would create duplicate
   * constructs under different ids for the same secret.
   */
  private couchbaseSecret(config: StageConfig): secretsmanager.ISecret {
    if (!config.couchbase) {
      throw new Error(
        `Stage "${config.stageName}" has no couchbase configuration, but a ` +
          'Lambda declares metadata.lambda.couchbase. Add it to ' +
          'infra/aws/config/stages.ts, or drop the declaration.'
      );
    }

    this.cachedCouchbaseSecret ??= secretsmanager.Secret.fromSecretNameV2(
      this,
      'CouchbaseSecret',
      config.couchbase.secretName
    );
    return this.cachedCouchbaseSecret;
  }

  private cachedCouchbaseSecret?: secretsmanager.ISecret;

  /**
   * The LWA application credentials, referenced rather than created (#55).
   *
   * Same reasoning as the Couchbase secret, and the same lazy-once construction:
   * CDK must never hold this value, so it is created out of band by
   * `scripts/amazon-oauth-secret.sh` and referenced by name.
   */
  private amazonOauthSecret(config: StageConfig): secretsmanager.ISecret {
    if (!config.amazonOauth) {
      throw new Error(
        `Stage "${config.stageName}" has no amazonOauth configuration, but a ` +
          'Lambda declares metadata.lambda.amazonCredentials. Add it to ' +
          'infra/aws/config/stages.ts, or drop the declaration.'
      );
    }

    this.cachedAmazonOauthSecret ??= secretsmanager.Secret.fromSecretNameV2(
      this,
      'AmazonOauthSecret',
      config.amazonOauth.secretName
    );
    return this.cachedAmazonOauthSecret;
  }

  private cachedAmazonOauthSecret?: secretsmanager.ISecret;

  /**
   * Tell unattended callers where the credential service lives (#152).
   *
   * After the API is built, because the URL is only known then — and safe to do
   * that way for one specific reason: an unattended caller is queue-driven and
   * declares no routes, so it is not an integration target. A function that WAS
   * a target would create a CloudFormation cycle (function needs the API's id,
   * the API's integration needs the function), which surfaces as an error naming
   * neither of them. That is why this refuses rather than trusting the caller to
   * have noticed.
   */
  private wireCredentialServiceCallers(
    apps: LambdaApp[],
    apiEndpoint: string | undefined
  ): void {
    for (const app of apps.filter(
      (candidate) => candidate.callsCredentialService
    )) {
      if (app.routes?.length) {
        throw new Error(
          `Lambda "${app.name}" declares callsCredentialService and also ` +
            'declares routes. A function cannot both be served by the private ' +
            'API and be told its URL — that is a CloudFormation cycle.'
        );
      }

      if (!apiEndpoint) {
        throw new Error(
          `Lambda "${app.name}" declares callsCredentialService, but no ` +
            'function declares routes, so this stage has no private API for it ' +
            'to call.'
        );
      }

      this.functions
        .get(app.name)
        ?.addEnvironment('CREDENTIALS_API_BASE_URL', apiEndpoint);
    }
  }

  /**
   * The service principal's Auth0 credentials, referenced by name (#152).
   *
   * Same out-of-band construction as the other two, for the same reason: CDK
   * must never hold the value. Created by
   * `scripts/auth0-service-principal-secret.sh`.
   */
  private auth0ServicePrincipalSecret(
    config: StageConfig
  ): secretsmanager.ISecret {
    if (!config.auth0ServicePrincipal) {
      throw new Error(
        `Stage "${config.stageName}" has no auth0ServicePrincipal ` +
          'configuration, but a Lambda declares ' +
          'metadata.lambda.callsCredentialService. Add it to ' +
          'infra/aws/config/stages.ts, or drop the declaration.'
      );
    }

    this.cachedAuth0ServicePrincipalSecret ??=
      secretsmanager.Secret.fromSecretNameV2(
        this,
        'Auth0ServicePrincipalSecret',
        config.auth0ServicePrincipal.secretName
      );
    return this.cachedAuth0ServicePrincipalSecret;
  }

  private cachedAuth0ServicePrincipalSecret?: secretsmanager.ISecret;

  /**
   * The credentials KMS key, IMPORTED from the key stack's export.
   *
   * Imported rather than passed in as a construct, and that is the load-bearing
   * detail. `Key.grant` on an owned key edits the key's own resource policy,
   * which would need this stack's role ARN inside the key stack while this stack
   * needs the key ARN — a CloudFormation dependency cycle, at synth, with a
   * message about neither of those things. An imported key cannot have its
   * policy edited, so `grant` writes only to the function's role, which is all
   * that is needed: the key's policy already trusts account identities.
   *
   * The dependency runs one way, key stack to lambdas stack, and `app.ts`
   * declares it explicitly — `Fn.importValue` is an opaque token, so CDK cannot
   * infer the deploy ordering from it.
   */
  private credentialsKey(): kms.IKey {
    this.cachedCredentialsKey ??= kms.Key.fromKeyArn(
      this,
      'CredentialsKey',
      Fn.importValue(credentialsKeyExportName(this.stageConfig))
    );
    return this.cachedCredentialsKey;
  }

  private cachedCredentialsKey?: kms.IKey;

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
        // A POINTER, and nothing else. The host, bucket, scope and login all
        // live inside the secret together (ADR-0010): they change as one unit
        // when a cluster is rebuilt, so one write updates an environment with
        // no deploy — and nothing can end up holding a new host with an old
        // login. Only the secret's NAME is here, which is not sensitive and
        // still says which environment this function belongs to.
        ...(app.couchbase && config.couchbase
          ? { CB_CREDENTIALS_SECRET_ID: config.couchbase.secretName }
          : {}),
        // Also pointers only. The secret NAME says which environment's LWA
        // applications to use; the key ALIAS names a key whose whole security
        // is the IAM grant above, not obscurity about its identity. Neither is
        // sensitive, and both are worth being able to read off the function.
        ...(app.amazonCredentials && config.amazonOauth
          ? {
              AMAZON_OAUTH_SECRET_ID: config.amazonOauth.secretName,
              KMS_CREDENTIAL_KEY_ID: credentialsKeyAlias(config),
            }
          : {}),
        // Auth0 subjects, not secrets — see `servicePrincipals` in stages.ts.
        // Omitted rather than set empty when a stage has none, so `cdk diff`
        // distinguishes "no principal configured" from "configured with
        // nothing", which are the same at runtime and different to a reader.
        ...(app.amazonCredentials && config.servicePrincipals?.length
          ? { SERVICE_PRINCIPALS: config.servicePrincipals.join(',') }
          : {}),
        // A pointer again. The base URL is added after the API exists — see
        // `wireCredentialServiceCallers`.
        ...(app.callsCredentialService && config.auth0ServicePrincipal
          ? {
              AUTH0_SERVICE_PRINCIPAL_SECRET_ID:
                config.auth0ServicePrincipal.secretName,
            }
          : {}),
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
