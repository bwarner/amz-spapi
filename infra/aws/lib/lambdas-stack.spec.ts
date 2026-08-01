import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { STAGES } from '../config/stages.js';
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

function synth(root: string): Template {
  const app = new cdk.App();
  const stack = new LambdasStack(app, 'test-lambdas', {
    env: { account: '111122223333', region: 'us-east-1' },
    config: STAGES.dev,
    workspaceRoot: root,
  });
  return Template.fromStack(stack);
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

  it('warns at synth that the routes have no authorizer yet', () => {
    // #54 has not wired Auth0. Until it does, every route is open, and that
    // should be impossible to miss rather than a comment in a file.
    const root = workspace({
      orders: { packaging: 'zip', routes: ['GET /orders'] },
    });
    const app = new cdk.App();
    const stack = new LambdasStack(app, 'test-lambdas', {
      env: { account: '111122223333', region: 'us-east-1' },
      config: STAGES.dev,
      workspaceRoot: root,
    });
    Template.fromStack(stack);

    const warnings = Annotations.fromStack(stack).findWarning(
      '*',
      Match.stringLikeRegexp('no authorizer')
    );
    expect(warnings.length).toBeGreaterThan(0);
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
