import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { LambdasStack } from './lambdas-stack.js';

/**
 * These cover the packaging decision itself, not CDK's constructs.
 *
 * The image path had no test while it was unreachable — nothing in the
 * workspace declared `packaging: "image"` — so the first function to need it
 * would have been the one to find out whether it worked. A fixture workspace
 * exercises both paths without adding a Lambda to the repo to carry the test.
 */

type Fixture = {
  packaging: 'zip' | 'image';
  handler?: string;
  body?: string;
  routes?: string[];
  couchbase?: boolean;
  amazonCredentials?: boolean;
};

/** A throwaway workspace root laid out the way discoverLambdaApps expects. */
function workspace(apps: Record<string, Fixture>): string {
  const root = mkdtempSync(join(tmpdir(), 'lambdas-stack-'));

  for (const [name, fixture] of Object.entries(apps)) {
    const appDir = join(root, 'apps', 'lambdas', name);
    const distDir = join(root, 'dist', 'apps', 'lambdas', name);
    mkdirSync(appDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    writeFileSync(
      join(appDir, 'project.json'),
      JSON.stringify({
        name: `lambda-${name}`,
        metadata: {
          lambda: {
            packaging: fixture.packaging,
            handler: fixture.handler ?? 'main.handler',
            description: `${name} fixture`,
            ...(fixture.routes ? { routes: fixture.routes } : {}),
            ...(fixture.couchbase === undefined
              ? {}
              : { couchbase: fixture.couchbase }),
            ...(fixture.amazonCredentials === undefined
              ? {}
              : { amazonCredentials: fixture.amazonCredentials }),
          },
        },
      })
    );

    writeFileSync(
      join(distDir, 'main.js'),
      fixture.body ?? 'export const handler = async () => ({});\n'
    );
    if (fixture.packaging === 'image') {
      writeFileSync(
        join(distDir, 'Dockerfile'),
        'FROM public.ecr.aws/lambda/nodejs:24\nCOPY . ${LAMBDA_TASK_ROOT}\n'
      );
    }
  }

  return root;
}

/** A stage with no Auth0 tenant, i.e. one that has not reached #54 yet. */
const UNAUTHENTICATED_STAGE: StageConfig = {
  ...STAGES.dev,
  auth0Domain: undefined,
  auth0Audience: undefined,
};

function stackOf(root: string, config: StageConfig = STAGES.dev): LambdasStack {
  const app = new cdk.App();
  return new LambdasStack(app, 'test-lambdas', {
    env: { account: '111122223333', region: 'us-east-1' },
    config,
    workspaceRoot: root,
  });
}

function synth(root: string, config: StageConfig = STAGES.dev): Template {
  return Template.fromStack(stackOf(root, config));
}

/** The tag on an image function's ImageUri, which is the asset's content hash. */
function imageTag(template: Template, logicalIdPrefix: string): string {
  const functions = template.findResources('AWS::Lambda::Function');
  const [, fn] = Object.entries(functions).find(([id]) =>
    id.startsWith(logicalIdPrefix)
  )!;
  const parts: unknown[] = fn.Properties.Code.ImageUri['Fn::Sub'];
  // Fn::Sub over a single string for image assets: "<registry>/<repo>:<hash>".
  const uri = typeof parts === 'string' ? parts : String(parts);
  return uri.slice(uri.lastIndexOf(':') + 1);
}

describe('LambdasStack packaging', () => {
  it('builds a zip function from the built directory', () => {
    const template = synth(workspace({ api: { packaging: 'zip' } }));

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sellavant-dev-api',
      Runtime: 'nodejs24.x',
      Handler: 'main.handler',
    });
  });

  it('builds an image function with no Runtime or Handler property', () => {
    const template = synth(workspace({ resize: { packaging: 'image' } }));

    const functions = template.findResources('AWS::Lambda::Function');
    const fn = Object.values(functions)[0];

    expect(fn.Properties.PackageType).toBe('Image');
    // Lambda rejects both on an image function; the earlier code carried a
    // destructure whose only job was to drop Handler again.
    expect(fn.Properties.Runtime).toBeUndefined();
    expect(fn.Properties.Handler).toBeUndefined();
  });

  it('drives the image CMD from the same handler declaration as zip', () => {
    const template = synth(
      workspace({ resize: { packaging: 'image', handler: 'index.onEvent' } })
    );

    template.hasResourceProperties('AWS::Lambda::Function', {
      ImageConfig: { Command: ['index.onEvent'] },
    });
  });

  it('creates no ECR repository of its own', () => {
    // Image assets go to the repository cdk bootstrap already provides, which
    // is IMMUTABLE and already grants lambda.amazonaws.com pull. A per-function
    // repository here would have to be deployed before the function that reads
    // it, which is not possible inside one stack.
    const template = synth(
      workspace({ a: { packaging: 'image' }, b: { packaging: 'zip' } })
    );

    template.resourceCountIs('AWS::ECR::Repository', 0);
  });

  it('gives every function its own retained-by-stage log group', () => {
    const template = synth(
      workspace({ a: { packaging: 'image' }, b: { packaging: 'zip' } })
    );

    template.resourceCountIs('AWS::Logs::LogGroup', 2);
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/sellavant-dev-a',
      RetentionInDays: 30,
    });
  });
});

describe('LambdasStack image identity', () => {
  /**
   * The claim ADR-0003 rests on: the deployed image is named by a hash of the
   * build output, so the template differs exactly when the code differs. If
   * these ever pass with the assertions swapped, a deploy has become a no-op.
   */

  it('names the same build output with the same hash', () => {
    const same = 'export const handler = async () => ({ v: 1 });\n';
    const first = synth(
      workspace({ resize: { packaging: 'image', body: same } })
    );
    const second = synth(
      workspace({ resize: { packaging: 'image', body: same } })
    );

    expect(imageTag(first, 'Resize')).toBe(imageTag(second, 'Resize'));
  });

  it('names changed build output with a different hash', () => {
    const before = synth(
      workspace({
        resize: { packaging: 'image', body: 'export const v = 1;\n' },
      })
    );
    const after = synth(
      workspace({
        resize: { packaging: 'image', body: 'export const v = 2;\n' },
      })
    );

    expect(imageTag(before, 'Resize')).not.toBe(imageTag(after, 'Resize'));
  });
});

describe('LambdasStack versions and aliases', () => {
  it('publishes a version and a live alias for every function', () => {
    const template = synth(
      workspace({ a: { packaging: 'zip' }, b: { packaging: 'image' } })
    );

    template.resourceCountIs('AWS::Lambda::Version', 2);
    template.resourceCountIs('AWS::Lambda::Alias', 2);
    template.hasResourceProperties('AWS::Lambda::Alias', { Name: 'live' });
  });

  it('publishes a different version when the built output changes', () => {
    // Without this the alias would point at the same version forever and a
    // deploy would move nothing.
    const versionId = (template: Template) =>
      Object.keys(template.findResources('AWS::Lambda::Version'))[0];

    const before = synth(
      workspace({ a: { packaging: 'zip', body: 'export const v = 1;\n' } })
    );
    const after = synth(
      workspace({ a: { packaging: 'zip', body: 'export const v = 2;\n' } })
    );

    // CDK hashes the version into its logical id, so a new one means a new
    // AWS::Lambda::Version resource rather than an in-place edit.
    expect(versionId(before)).not.toBe(versionId(after));
  });

  it('outputs the alias ARN, not the bare function ARN', () => {
    const template = synth(workspace({ orders: { packaging: 'zip' } }));

    const outputs = template.findOutputs('OrdersFunctionArn');
    expect(JSON.stringify(outputs)).toContain('OrdersAlias');
  });
});

describe('LambdasStack HTTP routes', () => {
  it('builds no API when nothing declared a route', () => {
    const template = synth(workspace({ triage: { packaging: 'zip' } }));

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 0);
  });

  it('routes only the apps that asked for it', () => {
    const template = synth(
      workspace({
        orders: { packaging: 'zip', routes: ['GET /orders'] },
        triage: { packaging: 'zip' },
      })
    );

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /orders',
    });
  });

  it('shares one integration across a function that answers several routes', () => {
    const template = synth(
      workspace({
        orders: {
          packaging: 'zip',
          routes: ['GET /orders', 'GET /orders/{orderId}', 'POST /orders'],
        },
      })
    );

    // The integration is the function, not the path: three routes, one target.
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 1);
  });

  it('lets API Gateway invoke the alias, not the bare function', () => {
    const template = synth(
      workspace({ orders: { packaging: 'zip', routes: ['GET /orders'] } })
    );

    const permissions = template.findResources('AWS::Lambda::Permission');
    const [permission] = Object.values(permissions);

    expect(permission.Properties.Principal).toBe('apigateway.amazonaws.com');
    // Granted on the alias: an integration pointing at $LATEST could not be
    // shifted gradually or rolled back.
    expect(JSON.stringify(permission.Properties.FunctionName)).toContain(
      'OrdersAlias'
    );
  });

  it('routes an image-packaged function the same as a zip one', () => {
    const template = synth(
      workspace({ resize: { packaging: 'image', routes: ['POST /resize'] } })
    );

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /resize',
    });
  });

  it('warns at synth when the stage has no Auth0 tenant', () => {
    // A stage can be stood up before its Auth0 API exists, but every route is
    // then open, and that should be impossible to miss rather than a comment
    // in a file.
    const stack = stackOf(
      workspace({ orders: { packaging: 'zip', routes: ['GET /orders'] } }),
      UNAUTHENTICATED_STAGE
    );
    Template.fromStack(stack);

    const warnings = Annotations.fromStack(stack).findWarning(
      '*',
      Match.stringLikeRegexp('no authorizer')
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('LambdasStack Auth0 authorizer', () => {
  const routed = () =>
    workspace({ orders: { packaging: 'zip', routes: ['GET /orders'] } });

  it('attaches a JWT authorizer built from the stage settings', () => {
    const template = synth(routed());

    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: {
        Issuer: 'https://sellavant-dev.us.auth0.com/',
        Audience: ['https://local.sellavant.com'],
      },
    });
  });

  it('authorizes every route, leaving none open by omission', () => {
    const template = synth(
      workspace({
        orders: { packaging: 'zip', routes: ['GET /orders', 'POST /orders'] },
        me: { packaging: 'zip', routes: ['GET /me'] },
      })
    );

    const routes = Object.values(
      template.findResources('AWS::ApiGatewayV2::Route')
    );
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(route.Properties.AuthorizationType).toBe('JWT');
    }
  });

  it('does not warn when an authorizer is attached', () => {
    const stack = stackOf(routed());
    Template.fromStack(stack);

    expect(
      Annotations.fromStack(stack).findWarning(
        '*',
        Match.stringLikeRegexp('no authorizer')
      )
    ).toHaveLength(0);
  });

  it('builds no authorizer for a stage with no Auth0 tenant', () => {
    const template = synth(routed(), UNAUTHENTICATED_STAGE);

    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
  });

  it('creates no authorizer Lambda — the gateway does the validation', () => {
    // One function, the routed one. A second would mean a Lambda authorizer
    // crept back in, which is the cost this design exists to avoid.
    const template = synth(routed());

    template.resourceCountIs('AWS::Lambda::Function', 1);
  });
});

describe('LambdasStack refusals', () => {
  it('refuses to synth a Lambda that has not been built, naming the command', () => {
    const root = workspace({ api: { packaging: 'zip' } });
    // Same app, but pointed at a root where nothing was built.
    const unbuilt = mkdtempSync(join(tmpdir(), 'lambdas-stack-unbuilt-'));
    mkdirSync(join(unbuilt, 'apps', 'lambdas', 'api'), { recursive: true });
    writeFileSync(
      join(unbuilt, 'apps', 'lambdas', 'api', 'project.json'),
      JSON.stringify({
        name: 'lambda-api',
        metadata: { lambda: { packaging: 'zip', handler: 'main.handler' } },
      })
    );

    expect(() => synth(root)).not.toThrow();
    expect(() => synth(unbuilt)).toThrow(/Run: nx build lambda-api/);
  });

  it('refuses an image app whose build did not copy a Dockerfile', () => {
    const root = mkdtempSync(join(tmpdir(), 'lambdas-stack-nodocker-'));
    mkdirSync(join(root, 'apps', 'lambdas', 'resize'), { recursive: true });
    mkdirSync(join(root, 'dist', 'apps', 'lambdas', 'resize'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'apps', 'lambdas', 'resize', 'project.json'),
      JSON.stringify({
        name: 'lambda-resize',
        metadata: { lambda: { packaging: 'image', handler: 'main.handler' } },
      })
    );

    expect(() => synth(root)).toThrow(/Dockerfile/);
  });
});

/**
 * Couchbase access (#55).
 *
 * Two properties, and the second one is why the flag is opt-in rather than
 * derived. The Couchbase user's permissions are scope-wide (ADR-0005), so a
 * function holding the secret can read EVERY collection in the environment,
 * `credentials_profiles` included. `health` and `me` must not have it.
 */
describe('couchbase configuration', () => {
  const mixed = () =>
    workspace({
      reader: { packaging: 'zip', couchbase: true },
      bystander: { packaging: 'zip' },
    });

  it('gives a declaring function the secret pointer', () => {
    const template = Template.fromStack(stackOf(mixed()));

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: Match.stringLikeRegexp('reader$'),
      Environment: {
        Variables: Match.objectLike({
          CB_CREDENTIALS_SECRET_ID: STAGES.dev.couchbase?.secretName,
        }),
      },
    });
  });

  it('puts NOTHING about the connection in the template but the name', () => {
    // The whole point of moving all five into the secret. The template carries
    // a pointer; the host, bucket, scope and login are fetched at runtime, so
    // none of them is in the console or in GetFunctionConfiguration — and a
    // cluster move is a secret write rather than a deploy.
    const json = JSON.stringify(Template.fromStack(stackOf(mixed())).toJSON());

    for (const leaked of [
      'CB_PASSWORD',
      'CB_USERNAME',
      'CB_DATA_API_URL',
      'CB_BUCKET',
      'CB_SCOPE',
    ]) {
      expect(json).not.toContain(leaked);
    }
  });

  it('grants a declaring function read on the secret', () => {
    Template.fromStack(stackOf(mixed())).hasResourceProperties(
      'AWS::IAM::Policy',
      {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
              Effect: 'Allow',
            }),
          ]),
        }),
      }
    );
  });

  it('scopes the grant to that one secret, not every secret', () => {
    const policies = Template.fromStack(stackOf(mixed())).findResources(
      'AWS::IAM::Policy'
    );
    const statements = Object.values(policies).flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    const secretStatements = statements.filter((s) =>
      JSON.stringify(s['Action']).includes('secretsmanager')
    );

    expect(secretStatements.length).toBeGreaterThan(0);
    for (const statement of secretStatements) {
      expect(JSON.stringify(statement['Resource'])).toContain(
        STAGES.dev.couchbase?.secretName
      );
      expect(statement['Resource']).not.toBe('*');
    }
  });

  it('gives a NON-declaring function neither config nor grant', () => {
    // The important negative. A blanket grant would let `health` — which has no
    // authorizer and no reason to touch data — read every seller credential in
    // the environment.
    const template = Template.fromStack(stackOf(mixed()));
    const functions = template.findResources('AWS::Lambda::Function');
    const bystander = Object.values(functions).find((fn) =>
      String(fn.Properties.FunctionName).endsWith('bystander')
    );

    const vars = bystander?.Properties.Environment?.Variables ?? {};
    expect(Object.keys(vars).filter((k) => k.startsWith('CB_'))).toEqual([]);

    // And no policy names the bystander's role alongside the secret.
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const doc = JSON.stringify(policy.Properties.PolicyDocument);
      if (!doc.includes('secretsmanager')) continue;
      expect(JSON.stringify(policy.Properties.Roles)).not.toContain(
        'Bystander'
      );
    }
  });

  it('names the expected secret in the output', () => {
    // `fromSecretNameV2` does not check existence at synth, so a missing secret
    // fails at the first invocation. Printing it lets an operator check first.
    Template.fromStack(stackOf(mixed())).hasOutput('CouchbaseSecretName', {
      Value: STAGES.dev.couchbase?.secretName,
    });
  });

  it('fails synth when the stage has no couchbase configured', () => {
    // Deliberately an error, not a warning like the Auth0 case: an
    // unauthenticated route still functions, whereas this function would throw
    // on every request.
    const unconfigured: StageConfig = { ...STAGES.dev, couchbase: undefined };

    expect(() =>
      stackOf(
        workspace({ reader: { packaging: 'zip', couchbase: true } }),
        unconfigured
      )
    ).toThrow(/couchbase configuration/i);
  });

  it('leaves a stage with no couchbase alone when nothing declares it', () => {
    const unconfigured: StageConfig = { ...STAGES.dev, couchbase: undefined };

    expect(() =>
      stackOf(workspace({ plain: { packaging: 'zip' } }), unconfigured)
    ).not.toThrow();
  });

  it('prod declares no couchbase, so it cannot deploy one by accident', () => {
    // There is no prod scope yet and prod's bucket is a different cluster. A
    // placeholder would look configured and fail at the first request.
    expect(STAGES.prod.couchbase).toBeUndefined();
  });
});

/**
 * Access to seller credentials (#55).
 *
 * The heaviest grant in the workspace: KMS decrypt on the credentials key turns
 * a stored blob into a refresh token, and the Amazon OAuth secret turns that
 * refresh token into an access token for the seller's account. Holding both is
 * the capability, so the tests are mostly about who does NOT have it.
 */
describe('amazon credential access', () => {
  const mixed = () =>
    workspace({
      minter: { packaging: 'zip', couchbase: true, amazonCredentials: true },
      bystander: { packaging: 'zip', couchbase: true },
    });

  it('gives a declaring function both pointers', () => {
    Template.fromStack(stackOf(mixed())).hasResourceProperties(
      'AWS::Lambda::Function',
      {
        FunctionName: Match.stringLikeRegexp('minter$'),
        Environment: {
          Variables: Match.objectLike({
            AMAZON_OAUTH_SECRET_ID: STAGES.dev.amazonOauth?.secretName,
            KMS_CREDENTIAL_KEY_ID: 'alias/sellavant-dev-credentials',
          }),
        },
      }
    );
  });

  it('grants it decrypt on the credentials key', () => {
    const policies = Template.fromStack(stackOf(mixed())).findResources(
      'AWS::IAM::Policy'
    );
    const statements = Object.values(policies).flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    const kmsStatements = statements.filter((s) =>
      JSON.stringify(s['Action']).includes('kms:Decrypt')
    );

    expect(kmsStatements).toHaveLength(1);
    // Imported by export name, so the resource is the key ARN rather than a
    // wildcard — and rather than the alias ARN, which IAM does not honour.
    expect(JSON.stringify(kmsStatements[0]['Resource'])).toContain(
      'sellavant-dev-credentials-key-arn'
    );
    expect(kmsStatements[0]['Resource']).not.toBe('*');
  });

  it('does not edit the key policy, which would be a stack cycle', () => {
    // `Key.grant` on an OWNED key writes to the key's resource policy, needing
    // this stack's role ARN inside the key stack while this stack needs the key
    // ARN — a cycle CloudFormation reports as neither of those things. The key
    // is imported precisely so the grant is identity-only.
    const template = Template.fromStack(stackOf(mixed()));

    expect(Object.keys(template.findResources('AWS::KMS::Key'))).toEqual([]);
  });

  it('gives a function that only declared couchbase neither grant', () => {
    // The important negative. `sync-worker` reads Couchbase and must not be
    // able to unwrap what it reads.
    const template = Template.fromStack(stackOf(mixed()));
    const functions = template.findResources('AWS::Lambda::Function');
    const bystander = Object.values(functions).find((fn) =>
      String(fn.Properties.FunctionName).endsWith('bystander')
    );

    const vars = bystander?.Properties.Environment?.Variables ?? {};
    expect(vars['KMS_CREDENTIAL_KEY_ID']).toBeUndefined();
    expect(vars['AMAZON_OAUTH_SECRET_ID']).toBeUndefined();

    for (const policy of Object.values(
      template.findResources('AWS::IAM::Policy')
    )) {
      const doc = JSON.stringify(policy.Properties.PolicyDocument);
      if (!doc.includes('kms:Decrypt')) continue;
      expect(JSON.stringify(policy.Properties.Roles)).not.toContain(
        'Bystander'
      );
    }
  });

  it('scopes the OAuth secret grant to that one secret', () => {
    const policies = Template.fromStack(stackOf(mixed())).findResources(
      'AWS::IAM::Policy'
    );
    const statements = Object.values(policies).flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    const oauthStatements = statements.filter((s) =>
      JSON.stringify(s['Resource']).includes(
        STAGES.dev.amazonOauth?.secretName ?? 'never'
      )
    );

    expect(oauthStatements.length).toBeGreaterThan(0);
    for (const statement of oauthStatements) {
      expect(statement['Resource']).not.toBe('*');
    }
  });

  it('puts no client secret in the template, only the secret name', () => {
    const json = JSON.stringify(Template.fromStack(stackOf(mixed())).toJSON());

    expect(json).not.toContain('LWA_CLIENT_SECRET');
    expect(json).not.toContain('ADS_CLIENT_SECRET');
  });

  it('names the expected secret in the output', () => {
    Template.fromStack(stackOf(mixed())).hasOutput('AmazonOauthSecretName', {
      Value: STAGES.dev.amazonOauth?.secretName,
    });
  });

  it('fails synth when the stage has no amazonOauth configured', () => {
    const unconfigured: StageConfig = { ...STAGES.dev, amazonOauth: undefined };

    expect(() =>
      stackOf(
        workspace({
          minter: {
            packaging: 'zip',
            couchbase: true,
            amazonCredentials: true,
          },
        }),
        unconfigured
      )
    ).toThrow(/amazonOauth configuration/i);
  });

  it('prod declares no amazonOauth, so it cannot deploy one by accident', () => {
    expect(STAGES.prod.amazonOauth).toBeUndefined();
  });
});
