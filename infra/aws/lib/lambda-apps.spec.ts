import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverLambdaApps, parseLambdaMetadata } from './lambda-apps.js';

/**
 * The point of these is that a mistake in a project.json stops the synth rather
 * than deploying a function as the wrong kind of artefact — which would look
 * like a working deploy and fail at the first invocation.
 */

describe('parseLambdaMetadata', () => {
  const valid = {
    name: 'lambda-health',
    metadata: {
      lambda: {
        packaging: 'zip',
        handler: 'main.handler',
        description: 'Health check',
        timeoutSeconds: 10,
        memoryMb: 256,
      },
    },
  };

  it('reads a complete declaration', () => {
    const parsed = parseLambdaMetadata('health', valid);

    expect(parsed?.projectName).toBe('lambda-health');
    expect(parsed?.metadata).toMatchObject({
      packaging: 'zip',
      handler: 'main.handler',
      timeoutSeconds: 10,
      memoryMb: 256,
    });
  });

  it('treats a directory with no lambda block as not a Lambda', () => {
    // A shared fixture or helper folder is allowed to live here.
    expect(
      parseLambdaMetadata('helpers', { name: 'helpers', metadata: {} })
    ).toBeUndefined();
    expect(parseLambdaMetadata('helpers', { name: 'helpers' })).toBeUndefined();
  });

  it('rejects an unknown packaging rather than guessing', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: {
          lambda: { packaging: 'container', handler: 'main.handler' },
        },
      })
    ).toThrow(/packaging must be one of zip \| image/);
  });

  it('rejects a handler that is not file.export', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: { lambda: { packaging: 'zip', handler: 'main' } },
      })
    ).toThrow(/handler must look like "file\.export"/);
  });

  it('rejects nonsense sizing rather than deploying a default', () => {
    for (const bad of [0, -1, 'lots']) {
      expect(() =>
        parseLambdaMetadata('health', {
          name: 'lambda-health',
          metadata: {
            lambda: {
              packaging: 'zip',
              handler: 'main.handler',
              memoryMb: bad,
            },
          },
        })
      ).toThrow(/memoryMb must be a positive number/);
    }
  });

  it('reads route keys, which are what HttpApi consumes', () => {
    const parsed = parseLambdaMetadata('orders', {
      name: 'lambda-orders',
      metadata: {
        lambda: {
          packaging: 'zip',
          handler: 'main.handler',
          routes: ['GET /orders', 'GET /orders/{orderId}', 'ANY /orders/sync'],
        },
      },
    });

    expect(parsed?.metadata.routes).toEqual([
      'GET /orders',
      'GET /orders/{orderId}',
      'ANY /orders/sync',
    ]);
  });

  it('treats a function with no routes as not HTTP-facing', () => {
    const parsed = parseLambdaMetadata('triage', {
      name: 'lambda-triage',
      metadata: { lambda: { packaging: 'zip', handler: 'main.handler' } },
    });

    expect(parsed?.metadata.routes).toBeUndefined();
  });

  it('rejects a bare path, which would have to be given every method', () => {
    expect(() =>
      parseLambdaMetadata('orders', {
        name: 'lambda-orders',
        metadata: {
          lambda: {
            packaging: 'zip',
            handler: 'main.handler',
            routes: ['/orders'],
          },
        },
      })
    ).toThrow(/must look like "GET \/health"/);
  });

  it('rejects a method API Gateway does not accept', () => {
    expect(() =>
      parseLambdaMetadata('orders', {
        name: 'lambda-orders',
        metadata: {
          lambda: {
            packaging: 'zip',
            handler: 'main.handler',
            routes: ['FETCH /orders'],
          },
        },
      })
    ).toThrow(/method FETCH, which API Gateway does not accept/);
  });

  it('rejects an empty routes array rather than building a routeless API', () => {
    expect(() =>
      parseLambdaMetadata('orders', {
        name: 'lambda-orders',
        metadata: {
          lambda: { packaging: 'zip', handler: 'main.handler', routes: [] },
        },
      })
    ).toThrow(/non-empty array/);
  });

  it('names the file to fix in every error', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: { lambda: { packaging: 'nope', handler: 'main.handler' } },
      })
    ).toThrow(/apps\/lambdas\/health\/project\.json/);
  });
});

describe('discoverLambdaApps', () => {
  it('finds the health app in this workspace, with its paths resolved', () => {
    const apps = discoverLambdaApps(process.cwd().replace(/\/infra\/aws$/, ''));

    const health = apps.find((app) => app.name === 'health');
    expect(health).toBeDefined();
    expect(health?.packaging).toBe('zip');
    expect(health?.projectName).toBe('lambda-health');
    expect(health?.distPath).toBe('dist/apps/lambdas/health');
    expect(health?.appPath).toBe('apps/lambdas/health');
  });

  it('returns a stable order, so a synthesised diff means a real change', () => {
    const root = process.cwd().replace(/\/infra\/aws$/, '');
    const names = discoverLambdaApps(root).map((app) => app.name);

    expect(names).toEqual([...names].sort());
  });

  it('returns nothing when there is no lambdas directory', () => {
    expect(discoverLambdaApps('/tmp/definitely-not-a-workspace')).toEqual([]);
  });

  it('refuses two apps claiming one route, naming both', () => {
    const root = mkdtempSync(join(tmpdir(), 'lambda-apps-'));
    for (const name of ['orders', 'orders-legacy']) {
      const dir = join(root, 'apps', 'lambdas', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'project.json'),
        JSON.stringify({
          name: `lambda-${name}`,
          metadata: {
            lambda: {
              packaging: 'zip',
              handler: 'main.handler',
              routes: ['GET /orders'],
            },
          },
        })
      );
    }

    expect(() => discoverLambdaApps(root)).toThrow(/claimed by both/);
    expect(() => discoverLambdaApps(root)).toThrow(/orders-legacy/);
  });
});

/**
 * The couchbase declaration (#55).
 *
 * It governs an IAM grant to a secret whose user has scope-wide permissions
 * (ADR-0005), so a function holding it can read every collection in the
 * environment — `credentials_profiles` included.
 */
describe('metadata.lambda.couchbase', () => {
  const appWith = (couchbase: unknown) => ({
    name: 'lambda-x',
    metadata: {
      lambda: { packaging: 'zip', handler: 'main.handler', couchbase },
    },
  });

  it('must be a boolean', () => {
    // Strict rather than truthy: `"false"` and `"no"` are truthy strings, and
    // either would silently widen access.
    expect(() => parseLambdaMetadata('x', appWith('true'))).toThrow(
      /must be a boolean/
    );
  });

  it('defaults to false when absent', () => {
    // The safe default for a grant.
    const parsed = parseLambdaMetadata('x', {
      name: 'lambda-x',
      metadata: { lambda: { packaging: 'zip', handler: 'main.handler' } },
    });

    expect(parsed?.metadata.couchbase).toBe(false);
  });

  it('is carried through when declared', () => {
    expect(parseLambdaMetadata('x', appWith(true))?.metadata.couchbase).toBe(
      true
    );
  });

  /**
   * Drift guard against the real workspace.
   *
   * The declaration and the dependency are two places that have to agree, and
   * nothing else makes them. A Lambda that adds `couchbase-utils` and forgets
   * the flag deploys happily and throws on its first request; one that declares
   * the flag without the dependency holds a credential grant it never uses.
   *
   * Checks the DIRECT dependency, which is what every Couchbase Lambda has
   * today. A future app reaching Couchbase only transitively would slip past
   * this — the runtime failure is loud and names the fix, and walking the
   * dependency graph here would be a lot of machinery for a case that has not
   * happened.
   */
  it('matches what each app actually depends on', () => {
    const root = process.cwd().replace(/\/infra\/aws$/, '');

    for (const app of discoverLambdaApps(root)) {
      const manifest = JSON.parse(
        readFileSync(join(root, app.appPath, 'package.json'), 'utf8')
      ) as { dependencies?: Record<string, string> };
      const dependsOnCouchbase = Boolean(
        manifest.dependencies?.['@amz-spapi/couchbase-utils']
      );

      expect(
        app.couchbase ?? false,
        dependsOnCouchbase
          ? `${app.name} depends on couchbase-utils but does not declare ` +
              `metadata.lambda.couchbase: true in apps/lambdas/${app.name}/project.json`
          : `${app.name} declares metadata.lambda.couchbase but does not depend ` +
              'on @amz-spapi/couchbase-utils — it would hold a credential grant it never uses'
      ).toBe(dependsOnCouchbase);
    }
  });
});

/**
 * The amazonCredentials declaration (#55).
 *
 * The heaviest grant in the workspace: KMS decrypt on the credentials key plus
 * the LWA client secret is, together, the ability to act as any connected
 * seller. It should stay on exactly one function.
 */
describe('metadata.lambda.amazonCredentials', () => {
  const appWith = (lambda: Record<string, unknown>) => ({
    name: 'lambda-x',
    metadata: {
      lambda: { packaging: 'zip', handler: 'main.handler', ...lambda },
    },
  });

  it('must be a boolean', () => {
    expect(() =>
      parseLambdaMetadata('x', appWith({ amazonCredentials: 'true' }))
    ).toThrow(/must be a boolean/);
  });

  it('defaults to false when absent', () => {
    expect(
      parseLambdaMetadata('x', appWith({}))?.metadata.amazonCredentials
    ).toBe(false);
  });

  it('requires couchbase, since the secrets live on the profile documents', () => {
    // Otherwise it deploys clean and fails at the first request, having got the
    // key grant it cannot use.
    expect(() =>
      parseLambdaMetadata('x', appWith({ amazonCredentials: true }))
    ).toThrow(/needs couchbase/);
  });

  it('is carried through when declared alongside couchbase', () => {
    expect(
      parseLambdaMetadata(
        'x',
        appWith({ amazonCredentials: true, couchbase: true })
      )?.metadata.amazonCredentials
    ).toBe(true);
  });

  it('is declared by exactly one app in the workspace', () => {
    // Not a style rule. Every function holding this can act as any connected
    // seller, so a second one is a second blast radius — if another needs a
    // token it should call the credentials API, not hold the key.
    const root = process.cwd().replace(/\/infra\/aws$/, '');
    const holders = discoverLambdaApps(root)
      .filter((app) => app.amazonCredentials)
      .map((app) => app.name);

    expect(holders).toEqual(['credentials']);
  });
});
